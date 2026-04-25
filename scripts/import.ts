/**
 * Import usenet JSON archive into SQLite.
 *
 * Usage: npx tsx scripts/import.ts /path/to/usenet/archive
 *
 * This reads the processed/ directories, does NOT modify the originals.
 * Creates data/usenet.db with full-text search via FTS5.
 */

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const archivePath = process.argv[2];
if (!archivePath) {
  console.error("Usage: npx tsx scripts/import.ts /path/to/usenet/archive");
  process.exit(1);
}

const dbPath = path.join(__dirname, "..", "data", "usenet.db");

// Remove existing db if present
if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
  console.log("Removed existing database");
}

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

// Create schema
db.exec(`
  CREATE TABLE newsgroups (
    name TEXT PRIMARY KEY,
    message_count INTEGER NOT NULL DEFAULT 0,
    first_date TEXT,
    last_date TEXT
  );

  CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    newsgroup TEXT NOT NULL,
    original_id INTEGER NOT NULL,
    from_addr TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    message_id TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (newsgroup) REFERENCES newsgroups(name)
  );

  CREATE INDEX idx_messages_group ON messages(newsgroup, original_id);

  CREATE VIRTUAL TABLE messages_fts USING fts5(
    body,
    content='messages',
    content_rowid='id'
  );
`);

console.log("Schema created");

const insertGroup = db.prepare(
  `INSERT INTO newsgroups (name, message_count, first_date, last_date) VALUES (?, ?, ?, ?)`
);
const insertMsg = db.prepare(
  `INSERT INTO messages (newsgroup, original_id, from_addr, date, subject, message_id, body)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);
const insertFts = db.prepare(
  `INSERT INTO messages_fts (rowid, body) VALUES (?, ?)`
);

// Parse a "from" field, trying to clean it up
function cleanFrom(raw: string): string {
  if (!raw || raw === "(no author)") return "";
  return raw.trim();
}

// Try to extract a real date from the date field
// Many entries have body text leaking into the date field
function cleanDate(raw: string): string {
  if (!raw) return "";
  // Check if it looks like a real date (YYYY-MM-DD or contains month names)
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  // Try to find a date-like pattern
  const isoMatch = raw.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];
  // RFC 2822 style dates
  const rfcMatch = raw.match(
    /\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{4})\b/i
  );
  if (rfcMatch) return rfcMatch[1];
  // If it's just garbage text, return empty
  if (raw.length > 30) return "";
  return raw;
}

// Try to extract headers from body if metadata is missing
function extractHeadersFromBody(body: string): {
  from: string;
  date: string;
  subject: string;
  messageId: string;
  cleanBody: string;
} {
  const result = { from: "", date: "", subject: "", messageId: "", cleanBody: body };

  // Check if body contains raw headers (From -, X-Google-, Newsgroups:, etc.)
  const headerBoundary = body.indexOf("\r\n\r\n");
  if (headerBoundary === -1) return result;

  const potentialHeaders = body.slice(0, headerBoundary);
  const hasHeaders =
    /^(From|Date|Subject|Message-ID|Newsgroups|Path|X-Google):/im.test(
      potentialHeaders
    );
  if (!hasHeaders) return result;

  // Extract what we can
  const fromMatch = potentialHeaders.match(/^From:\s*(.+)$/im);
  if (fromMatch) result.from = fromMatch[1].trim();

  const dateMatch = potentialHeaders.match(/^Date:\s*(.+)$/im);
  if (dateMatch) result.date = dateMatch[1].trim();

  const subjMatch = potentialHeaders.match(/^Subject:\s*(.+)$/im);
  if (subjMatch) result.subject = subjMatch[1].trim();

  const midMatch = potentialHeaders.match(/^Message-ID:\s*(.+)$/im);
  if (midMatch) result.messageId = midMatch[1].trim();

  // The actual body starts after the header block
  result.cleanBody = body.slice(headerBoundary).replace(/^\r?\n\r?\n/, "");

  return result;
}

// Scan the archive directory for newsgroup folders
const entries = fs.readdirSync(archivePath, { withFileTypes: true });
const groups = entries
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(archivePath, e.name, "processed")))
  .map((e) => e.name)
  .sort();

console.log(`Found ${groups.length} newsgroups: ${groups.join(", ")}`);

let totalMessages = 0;

const insertMany = db.transaction(
  (
    groupName: string,
    messages: Array<{
      id: number;
      from: string;
      date: string;
      subject: string;
      messageId: string;
      body: string;
    }>
  ) => {
    let firstDate = "";
    let lastDate = "";

    // Insert group row first so FK constraint is satisfied
    insertGroup.run(groupName, 0, null, null);

    for (const msg of messages) {
      let from = cleanFrom(msg.from);
      let date = cleanDate(msg.date);
      let subject = msg.subject || "";
      let messageId = msg.messageId || "";
      let body = msg.body || "";

      // If metadata is mostly empty, try extracting from body
      if (!from && !messageId && body.length > 100) {
        const extracted = extractHeadersFromBody(body);
        if (extracted.from) from = extracted.from;
        if (extracted.date) date = cleanDate(extracted.date);
        if (extracted.subject && subject === "(no subject)")
          subject = extracted.subject;
        if (extracted.messageId) messageId = extracted.messageId;
        if (extracted.cleanBody !== body) body = extracted.cleanBody;
      }

      const result = insertMsg.run(
        groupName,
        msg.id,
        from,
        date,
        subject,
        messageId,
        body
      );
      insertFts.run(result.lastInsertRowid, body);

      if (date && (!firstDate || date < firstDate)) firstDate = date;
      if (date && (!lastDate || date > lastDate)) lastDate = date;
    }

    // Update group with final counts/dates
    db.prepare(
      `UPDATE newsgroups SET message_count = ?, first_date = ?, last_date = ? WHERE name = ?`
    ).run(messages.length, firstDate || null, lastDate || null, groupName);
  }
);

for (const groupName of groups) {
  const messagesDir = path.join(archivePath, groupName, "processed", "messages");
  if (!fs.existsSync(messagesDir)) {
    console.log(`  Skipping ${groupName}: no messages directory`);
    continue;
  }

  const files = fs
    .readdirSync(messagesDir)
    .filter((f) => f.endsWith(".json"))
    .sort((a, b) => {
      const na = parseInt(a);
      const nb = parseInt(b);
      return na - nb;
    });

  console.log(`  ${groupName}: ${files.length} messages`);

  const messages: Array<{
    id: number;
    from: string;
    date: string;
    subject: string;
    messageId: string;
    body: string;
  }> = [];

  for (const file of files) {
    const raw = fs.readFileSync(path.join(messagesDir, file), "utf-8");
    try {
      const msg = JSON.parse(raw);
      messages.push({
        id: msg.id ?? parseInt(file),
        from: msg.from ?? "",
        date: msg.date ?? "",
        subject: msg.subject ?? "",
        messageId: msg.messageId ?? "",
        body: msg.body ?? "",
      });
    } catch {
      console.warn(`    Warning: failed to parse ${file}`);
    }
  }

  insertMany(groupName, messages);
  totalMessages += messages.length;
}

// Optimize FTS
db.exec(`INSERT INTO messages_fts(messages_fts) VALUES('optimize')`);

console.log(`\nDone. Imported ${totalMessages} messages from ${groups.length} groups.`);
console.log(`Database: ${dbPath}`);

db.close();
