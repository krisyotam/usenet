/**
 * Import mbox files (or mbox.zip files) into the usenet database.
 *
 * Handles Archive.org usenet collections which use .mbox.zip format
 * (one mbox file per newsgroup, zipped individually).
 *
 * Usage:
 *   npx tsx scripts/import-mbox.ts <path-to-mbox-or-directory>
 *
 * Accepts:
 *   - A single .mbox file
 *   - A single .mbox.zip file
 *   - A directory containing .mbox and/or .mbox.zip files
 *
 * The newsgroup name is derived from the filename (e.g. comp.lang.c.mbox.zip -> comp.lang.c).
 * Existing groups with the same name are skipped unless --replace is passed.
 */

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const args = process.argv.slice(2);
const replace = args.includes("--replace");
const inputPath = args.find((a) => !a.startsWith("--"));

if (!inputPath) {
  console.error(
    "Usage: npx tsx scripts/import-mbox.ts [--replace] <path-to-mbox-or-directory>"
  );
  process.exit(1);
}

const dbPath = path.join(__dirname, "..", "data", "usenet.db");
if (!fs.existsSync(dbPath)) {
  console.error("Database not found at", dbPath);
  console.error("Run the initial import first: npm run import <archive-path>");
  process.exit(1);
}

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

// Ensure FTS table exists
try {
  db.prepare("SELECT COUNT(*) FROM messages_fts").get();
} catch {
  console.log("Creating FTS table...");
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      body, content='messages', content_rowid='id'
    );
  `);
}

const insertGroup = db.prepare(
  `INSERT OR IGNORE INTO newsgroups (name, message_count, first_date, last_date)
   VALUES (?, 0, NULL, NULL)`
);
const deleteGroupMsgs = db.prepare(`DELETE FROM messages WHERE newsgroup = ?`);
const deleteGroup = db.prepare(`DELETE FROM newsgroups WHERE name = ?`);
const insertMsg = db.prepare(
  `INSERT INTO messages (newsgroup, original_id, from_addr, date, subject, message_id, body)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);
const insertFts = db.prepare(
  `INSERT INTO messages_fts (rowid, body) VALUES (?, ?)`
);
const updateGroup = db.prepare(
  `UPDATE newsgroups SET message_count = ?, first_date = ?, last_date = ? WHERE name = ?`
);

interface ParsedMessage {
  from: string;
  date: string;
  subject: string;
  messageId: string;
  body: string;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04",
  may: "05", jun: "06", jul: "07", aug: "08",
  sep: "09", oct: "10", nov: "11", dec: "12",
};

function normalizeDate(raw: string): string {
  if (!raw) return "";
  raw = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const rfc = raw.match(
    /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{4})/i
  );
  if (rfc) {
    const day = rfc[1].padStart(2, "0");
    const mon = MONTHS[rfc[2].slice(0, 3).toLowerCase()];
    const year = rfc[3];
    if (mon && parseInt(year) > 1970 && parseInt(year) < 2030) {
      return `${year}-${mon}-${day}`;
    }
  }

  const iso = raw.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) {
    const y = parseInt(iso[1].slice(0, 4));
    if (y > 1970 && y < 2030) return iso[1];
  }

  // "1997/04/30" format (Google Groups / Deja News style)
  const slash = raw.match(/(\d{4})\/(\d{2})\/(\d{2})/);
  if (slash) {
    const y = parseInt(slash[1]);
    if (y > 1970 && y < 2030) return `${slash[1]}-${slash[2]}-${slash[3]}`;
  }

  return "";
}

function parseMbox(content: string): ParsedMessage[] {
  const messages: ParsedMessage[] = [];

  // Split on mbox "From " lines at start of line
  // Handles both standard mbox ("From sender@... date") and
  // Google Groups format ("From <number>")
  const parts = content.split(/^From\s+(?:\S+.*\d{4}|-?\d{5,})\s*$/m);

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (!part || part.trim().length < 10) continue;

    // Split headers from body — walk lines to find first blank line after headers
    const lines = part.split(/\r?\n/);
    const headerLines: string[] = [];
    let bodyStart = 0;
    let foundHeader = false;

    for (let j = 0; j < lines.length; j++) {
      const line = lines[j];
      // Skip leading blank lines before headers start
      if (!foundHeader && line.trim() === "") continue;
      // Once we've seen headers, a blank line ends them
      if (foundHeader && line.trim() === "") {
        bodyStart = j + 1;
        break;
      }
      // Check if it looks like a header line or continuation
      if (/^[A-Za-z][A-Za-z0-9._-]*\s*:/.test(line) || (/^\s+/.test(line) && headerLines.length > 0)) {
        headerLines.push(line);
        foundHeader = true;
      } else if (!foundHeader) {
        // Not a header and we haven't found any yet — skip
        continue;
      } else {
        // Not a header line after headers started — body starts here
        bodyStart = j;
        break;
      }
    }

    // Parse headers (handle continuation lines)
    const headers: Record<string, string> = {};
    let currentKey = "";
    let currentVal = "";
    for (const line of headerLines) {
      if (/^\s+/.test(line) && currentKey) {
        currentVal += " " + line.trim();
        continue;
      }
      if (currentKey) headers[currentKey] = currentVal;
      const match = line.match(/^([A-Za-z][A-Za-z0-9-]*)\s*:\s*(.*)/);
      if (match) {
        currentKey = match[1].toLowerCase();
        currentVal = match[2];
      } else {
        currentKey = "";
      }
    }
    if (currentKey) headers[currentKey] = currentVal;

    const body = lines
      .slice(bodyStart)
      .join("\n")
      // Unescape mbox "From " quoting
      .replace(/^>From /gm, "From ")
      .trim();

    if (!body && !headers["subject"]) continue;

    messages.push({
      from: headers["from"] || "",
      date: normalizeDate(headers["date"] || ""),
      subject: headers["subject"] || "",
      messageId: headers["message-id"] || "",
      body,
    });
  }

  return messages;
}

function groupNameFromFile(filePath: string): string {
  const base = path.basename(filePath);
  return base.replace(/\.mbox(\.zip)?$/i, "");
}

function importMboxFile(filePath: string): void {
  const groupName = groupNameFromFile(filePath);

  // Check if group already exists
  const existing = db
    .prepare("SELECT message_count FROM newsgroups WHERE name = ?")
    .get(groupName) as { message_count: number } | undefined;

  if (existing && !replace) {
    console.log(`  Skipping ${groupName}: already exists (${existing.message_count} messages). Use --replace to overwrite.`);
    return;
  }

  // Get mbox content
  let content: string;
  if (filePath.endsWith(".mbox.zip")) {
    // Unzip to stdout
    try {
      content = execSync(`unzip -p "${filePath}"`, {
        maxBuffer: 1024 * 1024 * 1024, // 1GB
        encoding: "utf-8",
      });
    } catch (e: any) {
      // unzip may return exit code 1 for warnings but still output data
      if (e.stdout && e.stdout.length > 100) {
        content = e.stdout;
      } else {
        console.error(`  Error unzipping ${filePath}:`, e.message?.slice(0, 200));
        return;
      }
    }
  } else {
    content = fs.readFileSync(filePath, "utf-8");
  }

  if (!content || content.length < 50) {
    console.log(`  Skipping ${groupName}: empty or too small`);
    return;
  }

  const messages = parseMbox(content);
  if (messages.length === 0) {
    console.log(`  Skipping ${groupName}: no messages parsed`);
    return;
  }

  // Deduplicate by message-id
  const seen = new Set<string>();
  const deduped: ParsedMessage[] = [];
  for (const m of messages) {
    if (m.messageId && seen.has(m.messageId)) continue;
    if (m.messageId) seen.add(m.messageId);
    deduped.push(m);
  }

  // Sort by date
  deduped.sort((a, b) => {
    if (a.date && b.date) return a.date.localeCompare(b.date);
    if (a.date) return -1;
    if (b.date) return 1;
    return 0;
  });

  // Write to database in transaction
  const writeBatch = db.transaction(() => {
    if (existing && replace) {
      // Delete FTS entries for this group's messages
      const msgIds = db
        .prepare("SELECT id FROM messages WHERE newsgroup = ?")
        .all(groupName) as { id: number }[];
      const deleteFts = db.prepare(
        "DELETE FROM messages_fts WHERE rowid = ?"
      );
      for (const { id } of msgIds) deleteFts.run(id);
      deleteGroupMsgs.run(groupName);
      deleteGroup.run(groupName);
    }

    insertGroup.run(groupName);

    let firstDate = "";
    let lastDate = "";

    for (let i = 0; i < deduped.length; i++) {
      const m = deduped[i];
      const result = insertMsg.run(
        groupName, i, m.from, m.date, m.subject, m.messageId, m.body
      );
      insertFts.run(result.lastInsertRowid, m.body);
      if (m.date && (!firstDate || m.date < firstDate)) firstDate = m.date;
      if (m.date && (!lastDate || m.date > lastDate)) lastDate = m.date;
    }

    updateGroup.run(
      deduped.length,
      firstDate || null,
      lastDate || null,
      groupName
    );
  });

  writeBatch();
  console.log(
    `  ${groupName}: ${deduped.length} messages [${deduped[0]?.date || "?"} - ${deduped[deduped.length - 1]?.date || "?"}]`
  );
}

// Collect files to process
let files: string[] = [];
const stat = fs.statSync(inputPath);

if (stat.isDirectory()) {
  const entries = fs.readdirSync(inputPath);
  files = entries
    .filter((e) => e.endsWith(".mbox") || e.endsWith(".mbox.zip"))
    .map((e) => path.join(inputPath, e))
    .sort();
  console.log(`Found ${files.length} mbox files in ${inputPath}`);
} else {
  files = [inputPath];
}

let imported = 0;
for (const file of files) {
  try {
    importMboxFile(file);
    imported++;
  } catch (e: any) {
    console.error(`  Error processing ${path.basename(file)}: ${e.message?.slice(0, 200)}`);
  }
}

// Optimize FTS
console.log("Optimizing FTS index...");
db.exec(`INSERT INTO messages_fts(messages_fts) VALUES('optimize')`);

console.log(`\nDone. Processed ${imported}/${files.length} files.`);

// Show totals
const totals = db
  .prepare(
    "SELECT COUNT(*) as groups, SUM(message_count) as messages FROM newsgroups"
  )
  .get() as { groups: number; messages: number };
console.log(
  `Database now has ${totals.groups} groups, ${totals.messages?.toLocaleString()} messages.`
);

db.close();
