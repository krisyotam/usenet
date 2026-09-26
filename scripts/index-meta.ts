/**
 * Build (or rebuild) the header search index.
 *
 * The importers only index message bodies (messages_fts). This adds
 * meta_fts, an external-content FTS5 index over subject + from_addr,
 * which powers subject:/from: search and makes header matches rank.
 *
 * Safe to re-run: the index is derived entirely from `messages`.
 *
 *   npm run index:meta
 */
import Database from "better-sqlite3";
import path from "path";

const DB_PATH = process.argv[2] ?? path.join(process.cwd(), "data", "usenet.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("cache_size = -262144"); // 256 MiB

const t0 = Date.now();
const log = (s: string) =>
  console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);

log(`db: ${DB_PATH}`);
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS meta_fts USING fts5(
    subject,
    from_addr,
    content='messages',
    content_rowid='id'
  );
`);

log("rebuilding meta_fts (subject, from_addr)...");
db.exec(`INSERT INTO meta_fts(meta_fts) VALUES('rebuild')`);
log("optimizing...");
db.exec(`INSERT INTO meta_fts(meta_fts) VALUES('optimize')`);

log("refreshing planner statistics...");
db.exec(`ANALYZE newsgroups; ANALYZE messages;`);

const n = (db.prepare(`SELECT COUNT(*) AS c FROM messages`).get() as { c: number }).c;
log(`done — ${n.toLocaleString()} messages indexed`);
db.close();
