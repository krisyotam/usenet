/**
 * Import UTZOO tape archives into the usenet database.
 *
 * Handles both A-news (tape 001) and B-news (tapes 002-141) formats.
 *
 * A-news format (1979-1981):
 *   A<article-id>
 *   <newsgroup>
 *   <path>
 *   <date>
 *   <title>
 *   <body...>
 *
 * B-news format (1982-1991):
 *   Standard RFC-822 headers (From:, Newsgroups:, Subject:, Date:, etc.)
 *   followed by blank line, then body.
 *
 * Usage:
 *   npx tsx scripts/import-utzoo.ts <path-to-directory-with-tar.bz2-files>
 *   npx tsx scripts/import-utzoo.ts <single-tar.bz2-file>
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
    "Usage: npx tsx scripts/import-utzoo.ts [--replace] <path-or-tarball>"
  );
  process.exit(1);
}

const dbPath = path.join(__dirname, "..", "data", "usenet.db");
if (!fs.existsSync(dbPath)) {
  console.error("Database not found at", dbPath);
  process.exit(1);
}

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

// Ensure FTS table exists
try {
  db.prepare("SELECT COUNT(*) FROM messages_fts").get();
} catch {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      body, content='messages', content_rowid='id'
    );
  `);
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

  // "Wed May 12 11:37:20 1982" or "Fri Feb  6 00:19:47 1981"
  const unix = raw.match(
    /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+\S+\s+(\d{4})/i
  );
  if (unix) {
    const mon = MONTHS[unix[1].slice(0, 3).toLowerCase()];
    const day = unix[2].padStart(2, "0");
    const year = unix[3];
    if (mon && parseInt(year) > 1970 && parseInt(year) < 2000) {
      return `${year}-${mon}-${day}`;
    }
  }

  // "12 May 1982" or "12 May 82"
  const rfc = raw.match(
    /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{2,4})/i
  );
  if (rfc) {
    const day = rfc[1].padStart(2, "0");
    const mon = MONTHS[rfc[2].slice(0, 3).toLowerCase()];
    let year = rfc[3];
    if (year.length === 2) {
      year = parseInt(year) > 50 ? `19${year}` : `20${year}`;
    }
    if (mon && parseInt(year) > 1970 && parseInt(year) < 2000) {
      return `${year}-${mon}-${day}`;
    }
  }

  const iso = raw.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];

  return "";
}

interface ParsedArticle {
  newsgroup: string;
  from: string;
  date: string;
  subject: string;
  messageId: string;
  body: string;
}

function parseAnews(content: string): ParsedArticle | null {
  const lines = content.split("\n");
  if (lines.length < 5) return null;

  // A-news: line 0 = A<id>, line 1 = newsgroup, line 2 = path, line 3 = date, line 4 = title, rest = body
  const idLine = lines[0];
  if (!idLine.startsWith("A")) return null;

  const newsgroup = lines[1]?.trim().replace(/\./g, ".") || "unknown";
  const pathLine = lines[2]?.trim() || "";
  const date = normalizeDate(lines[3]?.trim() || "");
  const subject = lines[4]?.trim() || "";
  const body = lines.slice(5).join("\n").trim();

  // Extract "from" from path (last element in bang path)
  const from = pathLine.includes("!")
    ? pathLine.split("!").pop() || pathLine
    : pathLine;

  return {
    newsgroup: newsgroup.replace(/\s+/g, ""),
    from,
    date,
    subject,
    messageId: idLine.slice(1), // strip leading 'A'
    body,
  };
}

function parseBnews(content: string): ParsedArticle | null {
  const lines = content.split("\n");

  // Parse RFC-822 style headers
  const headers: Record<string, string> = {};
  let bodyStart = 0;
  let currentKey = "";
  let currentVal = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") {
      if (currentKey) headers[currentKey] = currentVal;
      bodyStart = i + 1;
      break;
    }
    if (/^\s+/.test(line) && currentKey) {
      currentVal += " " + line.trim();
      continue;
    }
    if (currentKey) headers[currentKey] = currentVal;
    const match = line.match(/^([A-Za-z][A-Za-z0-9._-]*)\s*:\s*(.*)/);
    if (match) {
      currentKey = match[1].toLowerCase();
      currentVal = match[2];
    } else {
      // Not a header — might be start of body
      bodyStart = i;
      break;
    }
  }

  const newsgroup = (
    headers["newsgroups"] || headers["newsgroup"] || "unknown"
  )
    .split(",")[0]
    .trim();

  const from = headers["from"] || "";
  const subject = headers["subject"] || headers["title"] || "";
  const date = normalizeDate(headers["date"] || headers["posted"] || "");
  const messageId =
    headers["message-id"] || headers["article-i.d."] || "";
  const body = lines.slice(bodyStart).join("\n").trim();

  if (!newsgroup || newsgroup === "unknown") return null;

  return { newsgroup, from, date, subject, messageId, body };
}

function walkDir(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full));
    } else if (entry.isFile() && !entry.name.startsWith(".")) {
      results.push(full);
    }
  }
  return results;
}

function processTape(tarPath: string): Map<string, ParsedArticle[]> {
  const groups = new Map<string, ParsedArticle[]>();

  const tapeName = path.basename(tarPath, ".tar.bz2");
  const isAnews = tapeName === "news001f1";

  // Extract all files to a temp directory
  const tmpDir = `/tmp/utzoo-extract-${Date.now()}`;
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    try {
      execSync(`tar xjf "${tarPath}" -C "${tmpDir}" 2>/dev/null`, {
        maxBuffer: 500 * 1024 * 1024,
      });
    } catch {
      console.log(`  ${tapeName}: extraction failed, skipping`);
      return groups;
    }

    // Walk the extracted directory tree
    const fileList = walkDir(tmpDir);

    let processed = 0;
    for (const fullPath of fileList) {
      let content: string;
      try {
        content = fs.readFileSync(fullPath, "utf-8");
      } catch {
        continue;
      }

      if (content.length < 10) continue;

      const article = isAnews ? parseAnews(content) : parseBnews(content);
      if (!article || !article.body) continue;

      // Normalize newsgroup name (some use dots, some use slashes)
      article.newsgroup = article.newsgroup
        .replace(/\//g, ".")
        .toLowerCase()
        .trim();

      if (!groups.has(article.newsgroup)) {
        groups.set(article.newsgroup, []);
      }
      groups.get(article.newsgroup)!.push(article);
      processed++;
    }

    console.log(
      `  ${tapeName}: ${processed} articles across ${groups.size} groups`
    );
  } finally {
    execSync(`rm -rf "${tmpDir}"`);
  }

  return groups;
}

// Prepared statements
const insertMsg = db.prepare(
  `INSERT INTO messages (newsgroup, original_id, from_addr, date, subject, message_id, body)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);
const insertFts = db.prepare(
  `INSERT INTO messages_fts (rowid, body) VALUES (?, ?)`
);

// Helper: append articles to database for a group, deduplicating against existing
function appendArticles(groupName: string, articles: ParsedArticle[]): number {
  if (articles.length === 0) return 0;

  // Ensure group exists
  db.prepare(
    "INSERT OR IGNORE INTO newsgroups (name, message_count, first_date, last_date) VALUES (?, 0, NULL, NULL)"
  ).run(groupName);

  const maxId = (
    db.prepare("SELECT MAX(original_id) as m FROM messages WHERE newsgroup = ?")
      .get(groupName) as { m: number | null }
  ).m ?? -1;

  // Get existing message-ids
  const existingIds = new Set(
    (db.prepare("SELECT message_id FROM messages WHERE newsgroup = ? AND message_id != ''")
      .all(groupName) as { message_id: string }[])
      .map((r) => r.message_id)
  );

  let added = 0;
  for (const a of articles) {
    if (a.messageId && existingIds.has(a.messageId)) continue;
    if (a.messageId) existingIds.add(a.messageId);
    if (!a.body && !a.subject && !a.from) continue;
    const result = insertMsg.run(
      groupName, maxId + 1 + added, a.from, a.date, a.subject, a.messageId, a.body
    );
    insertFts.run(result.lastInsertRowid, a.body);
    added++;
  }

  if (added > 0) {
    const newCount = (
      db.prepare("SELECT COUNT(*) as c FROM messages WHERE newsgroup = ?")
        .get(groupName) as { c: number }
    ).c;
    const dates = db.prepare(
      "SELECT MIN(date) as first, MAX(date) as last FROM messages WHERE newsgroup = ? AND date != ''"
    ).get(groupName) as { first: string; last: string };
    db.prepare(
      "UPDATE newsgroups SET message_count = ?, first_date = ?, last_date = ? WHERE name = ?"
    ).run(newCount, dates.first || null, dates.last || null, groupName);
  }

  return added;
}

// Collect tar files
let tarFiles: string[] = [];
const stat = fs.statSync(inputPath);

if (stat.isDirectory()) {
  tarFiles = fs
    .readdirSync(inputPath)
    .filter((f) => f.endsWith(".tar.bz2"))
    .sort()
    .map((f) => path.join(inputPath, f));
  console.log(`Found ${tarFiles.length} tape files in ${inputPath}`);
} else {
  tarFiles = [inputPath];
}

let totalMessages = 0;

// Process each tape and write immediately — don't accumulate across tapes
for (const tarFile of tarFiles) {
  const tapeGroups = processTape(tarFile);

  // Write this tape's articles to DB in a single transaction
  const writeTape = db.transaction(() => {
    let tapeAdded = 0;
    for (const [groupName, articles] of tapeGroups) {
      tapeAdded += appendArticles(groupName, articles);
    }
    return tapeAdded;
  });

  const added = writeTape();
  totalMessages += added;

  // Clear the map to free memory
  tapeGroups.clear();
}

// Optimize FTS
console.log("Optimizing FTS index...");
db.exec(`INSERT INTO messages_fts(messages_fts) VALUES('optimize')`);

const totals = db
  .prepare(
    "SELECT COUNT(*) as groups, SUM(message_count) as messages FROM newsgroups"
  )
  .get() as { groups: number; messages: number };
console.log(
  `\nDone. Added ${totalMessages.toLocaleString()} messages.`
);
console.log(
  `Database now has ${totals.groups} groups, ${totals.messages?.toLocaleString()} messages.`
);

db.close();
