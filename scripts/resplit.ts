/**
 * Re-split concatenated usenet blobs into individual messages.
 *
 * The original Google Groups scrape concatenated many posts into single
 * JSON "messages". This script reads the existing database, splits
 * concatenated blobs on `From <number>` boundaries, extracts proper
 * NNTP headers, and rebuilds the database with one row per real post.
 *
 * comp.os.minix is already clean — it gets copied as-is.
 *
 * Usage: npx tsx scripts/resplit.ts
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const dataDir = path.join(__dirname, "..", "data");
const srcPath = path.join(dataDir, "usenet.db");
const dstPath = path.join(dataDir, "usenet-resplit.db");

if (!fs.existsSync(srcPath)) {
  console.error("Source database not found at", srcPath);
  process.exit(1);
}

if (fs.existsSync(dstPath)) {
  fs.unlinkSync(dstPath);
}

const src = new Database(srcPath, { readonly: true });
const dst = new Database(dstPath);
dst.pragma("journal_mode = WAL");

dst.exec(`
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
`);

interface RawMessage {
  newsgroup: string;
  original_id: number;
  from_addr: string;
  date: string;
  subject: string;
  message_id: string;
  body: string;
}

interface ParsedMessage {
  from: string;
  date: string;
  subject: string;
  messageId: string;
  body: string;
}

function parseHeaders(headerBlock: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const lines = headerBlock.split(/\r?\n/);
  let currentKey = "";
  let currentVal = "";

  for (const line of lines) {
    // Continuation line (starts with whitespace)
    if (/^\s+/.test(line) && currentKey) {
      currentVal += " " + line.trim();
      continue;
    }
    // Save previous header
    if (currentKey) {
      headers[currentKey.toLowerCase()] = currentVal;
    }
    // Parse new header
    const match = line.match(/^([A-Za-z][A-Za-z0-9-]*)\s*:\s*(.*)/);
    if (match) {
      currentKey = match[1];
      currentVal = match[2];
    } else {
      currentKey = "";
      currentVal = "";
    }
  }
  if (currentKey) {
    headers[currentKey.toLowerCase()] = currentVal;
  }
  return headers;
}

function normalizeDate(raw: string): string {
  if (!raw) return "";
  raw = raw.trim();

  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  // Try parsing RFC 2822 and similar date formats
  // e.g. "Wed, 19 Jun 2013 07:41:30 +1000"
  // e.g. "18 Jun 2013 22:42:09 +0100"
  const months: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04",
    may: "05", jun: "06", jul: "07", aug: "08",
    sep: "09", oct: "10", nov: "11", dec: "12",
  };

  const rfc = raw.match(
    /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{4})/i
  );
  if (rfc) {
    const day = rfc[1].padStart(2, "0");
    const mon = months[rfc[2].slice(0, 3).toLowerCase()];
    const year = rfc[3];
    if (mon && parseInt(year) > 1970 && parseInt(year) < 2030) {
      return `${year}-${mon}-${day}`;
    }
  }

  // ISO embedded
  const iso = raw.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) {
    const y = parseInt(iso[1].slice(0, 4));
    if (y > 1970 && y < 2030) return iso[1];
  }

  return "";
}

function splitBlob(body: string): ParsedMessage[] {
  const results: ParsedMessage[] = [];

  // Split on "From <number>" at start of line
  // The pattern is: \n\nFrom <digits>\n followed by X-Google headers
  const parts = body.split(/\n(?=From\s+-?\d+\s*\r?\n)/);

  for (let i = 0; i < parts.length; i++) {
    let part = parts[i];

    // Strip the "From <number>" line itself
    part = part.replace(/^From\s+-?\d+\s*\r?\n/, "");

    // Skip tiny fragments (leftover tails from the previous message)
    if (part.trim().length < 20 && i === 0) continue;

    // Find header/body boundary: first blank line after headers
    // Headers start with X-Google-Thread or similar
    const hasHeaders = /^(X-Google-|Path:|From:|Newsgroups:|Date:|Subject:|Message-ID:)/im.test(
      part.slice(0, 500)
    );

    if (!hasHeaders) {
      // No headers — this is a bare text fragment (orphan tail of previous message or preamble)
      // Only include if it has real content
      if (part.trim().length > 50) {
        results.push({
          from: "",
          date: "",
          subject: "",
          messageId: "",
          body: part.replace(/^\r?\n/, "").replace(/\r\n/g, "\n").trim(),
        });
      }
      continue;
    }

    // Find the header/body boundary
    // Try \r\n\r\n first, then \n\n
    let headerEnd = -1;
    let sepLen = 0;

    // Walk line by line to find the first blank line after header-like lines
    const lines = part.split(/\r?\n/);
    let inHeaders = true;
    let headerLines: string[] = [];
    let bodyLines: string[] = [];

    for (let j = 0; j < lines.length; j++) {
      if (inHeaders) {
        // A blank line ends headers
        if (lines[j].trim() === "") {
          inHeaders = false;
          continue;
        }
        // Header continuation or new header
        if (/^[A-Za-z][A-Za-z0-9-]*\s*:/.test(lines[j]) || /^\s+/.test(lines[j])) {
          headerLines.push(lines[j]);
        } else {
          // Not a header line — everything from here is body
          inHeaders = false;
          bodyLines.push(lines[j]);
        }
      } else {
        bodyLines.push(lines[j]);
      }
    }

    const headers = parseHeaders(headerLines.join("\n"));
    const msgBody = bodyLines.join("\n").trim();

    results.push({
      from: headers["from"] || "",
      date: normalizeDate(headers["date"] || ""),
      subject: headers["subject"] || "",
      messageId: headers["message-id"] || "",
      body: msgBody,
    });
  }

  return results;
}

// Process each group
const groups = src
  .prepare("SELECT name FROM newsgroups ORDER BY name")
  .all() as { name: string }[];

const insertGroup = dst.prepare(
  "INSERT INTO newsgroups (name, message_count, first_date, last_date) VALUES (?, ?, ?, ?)"
);
const insertMsg = dst.prepare(
  `INSERT INTO messages (newsgroup, original_id, from_addr, date, subject, message_id, body)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);

let grandTotal = 0;

const updateGroup = dst.prepare(
  "UPDATE newsgroups SET message_count = ?, first_date = ?, last_date = ? WHERE name = ?"
);

for (const { name } of groups) {
  // Check if this group is clean by sampling
  const sampleStats = src
    .prepare(
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN from_addr = '' THEN 1 ELSE 0 END) as no_from
       FROM messages WHERE newsgroup = ?`
    )
    .get(name) as { total: number; no_from: number };

  const isClean = sampleStats.no_from / sampleStats.total < 0.1;

  // Insert group row first
  insertGroup.run(name, 0, null, null);

  let msgCount = 0;
  let firstDate = "";
  let lastDate = "";
  const seenIds = new Set<string>();

  // Process one blob at a time using an iterator to avoid loading all into memory
  const blobIter = src
    .prepare("SELECT * FROM messages WHERE newsgroup = ? ORDER BY original_id")
    .iterate(name) as IterableIterator<RawMessage>;

  // Use a transaction for every N inserts to keep it fast
  const BATCH_SIZE = 500;
  let batch: ParsedMessage[] = [];

  const flushBatch = () => {
    if (batch.length === 0) return;
    const writeBatch = dst.transaction(() => {
      for (const m of batch) {
        insertMsg.run(name, msgCount, m.from, m.date, m.subject, m.messageId, m.body);
        if (m.date && (!firstDate || m.date < firstDate)) firstDate = m.date;
        if (m.date && (!lastDate || m.date > lastDate)) lastDate = m.date;
        msgCount++;
      }
    });
    writeBatch();
    batch = [];
  };

  const addMessage = (m: ParsedMessage) => {
    // Deduplicate by message-id
    if (m.messageId) {
      if (seenIds.has(m.messageId)) return;
      seenIds.add(m.messageId);
    }
    // Skip empty
    if (!m.body && !m.subject && !m.from) return;
    batch.push(m);
    if (batch.length >= BATCH_SIZE) flushBatch();
  };

  if (isClean) {
    for (const msg of blobIter) {
      addMessage({
        from: msg.from_addr,
        date: normalizeDate(msg.date),
        subject: msg.subject,
        messageId: msg.message_id,
        body: msg.body,
      });
    }
    flushBatch();
    updateGroup.run(msgCount, firstDate || null, lastDate || null, name);
    console.log(`  ${name}: ${msgCount} messages (clean, copied as-is)`);
    grandTotal += msgCount;
    continue;
  }

  // Split concatenated blobs — process one blob at a time
  let blobCount = 0;
  for (const msg of blobIter) {
    blobCount++;
    const body = msg.body;
    if (!body || body.trim().length === 0) continue;

    const hasBoundaries = /^From\s+-?\d+/m.test(body);

    if (!hasBoundaries) {
      addMessage({
        from: msg.from_addr,
        date: normalizeDate(msg.date),
        subject: msg.subject !== "(no subject)" ? msg.subject : "",
        messageId: msg.message_id,
        body: body.replace(/\r\n/g, "\n").trim(),
      });
      continue;
    }

    const split = splitBlob(body);
    for (const m of split) {
      addMessage(m);
    }

    // Log progress for large groups
    if (blobCount % 100 === 0) {
      process.stdout.write(`\r  ${name}: ${blobCount} blobs processed, ${msgCount + batch.length} messages so far...`);
    }
  }

  flushBatch();
  updateGroup.run(msgCount, firstDate || null, lastDate || null, name);
  console.log(`\r  ${name}: ${blobCount} blobs -> ${msgCount} messages                    `);
  grandTotal += msgCount;
}

console.log(`\nTotal: ${grandTotal} messages`);

// Build FTS index
console.log("Building FTS index...");
dst.exec(`
  CREATE VIRTUAL TABLE messages_fts USING fts5(
    body,
    content='messages',
    content_rowid='id'
  );
  INSERT INTO messages_fts (rowid, body)
    SELECT id, body FROM messages;
  INSERT INTO messages_fts(messages_fts) VALUES('optimize');
`);

console.log("Done. Output:", dstPath);

// Swap databases
src.close();
dst.close();

const backupPath = path.join(dataDir, "usenet-original.db");
fs.renameSync(srcPath, backupPath);
fs.renameSync(dstPath, srcPath);
console.log(`Original database backed up to: ${backupPath}`);
console.log(`New database is now at: ${srcPath}`);
