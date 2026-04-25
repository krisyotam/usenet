import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "usenet.db");

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH, { readonly: true });
    _db.pragma("journal_mode = WAL");
  }
  return _db;
}

export interface Newsgroup {
  name: string;
  message_count: number;
  first_date: string | null;
  last_date: string | null;
}

export interface Message {
  id: number;
  newsgroup: string;
  original_id: number;
  from_addr: string;
  date: string;
  subject: string;
  message_id: string;
  body: string;
}

export function getNewsgroups(): Newsgroup[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT name, message_count, first_date, last_date
       FROM newsgroups ORDER BY name`
    )
    .all() as Newsgroup[];
}

export function getNewsgroup(name: string): Newsgroup | undefined {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM newsgroups WHERE name = ?`)
    .get(name) as Newsgroup | undefined;
}

export function getMessages(
  newsgroup: string,
  page: number,
  perPage: number = 50
): { messages: Message[]; total: number } {
  const db = getDb();
  const total = (
    db
      .prepare(`SELECT COUNT(*) as c FROM messages WHERE newsgroup = ?`)
      .get(newsgroup) as { c: number }
  ).c;
  const messages = db
    .prepare(
      `SELECT id, newsgroup, original_id, from_addr, date, subject, message_id
       FROM messages WHERE newsgroup = ?
       ORDER BY original_id ASC
       LIMIT ? OFFSET ?`
    )
    .all(newsgroup, perPage, (page - 1) * perPage) as Message[];
  return { messages, total };
}

export function getMessage(
  newsgroup: string,
  originalId: number
): Message | undefined {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM messages WHERE newsgroup = ? AND original_id = ?`
    )
    .get(newsgroup, originalId) as Message | undefined;
}

export function getAdjacentIds(
  newsgroup: string,
  originalId: number
): { prev: number | null; next: number | null } {
  const db = getDb();
  const prev = db
    .prepare(
      `SELECT original_id FROM messages
       WHERE newsgroup = ? AND original_id < ?
       ORDER BY original_id DESC LIMIT 1`
    )
    .get(newsgroup, originalId) as { original_id: number } | undefined;
  const next = db
    .prepare(
      `SELECT original_id FROM messages
       WHERE newsgroup = ? AND original_id > ?
       ORDER BY original_id ASC LIMIT 1`
    )
    .get(newsgroup, originalId) as { original_id: number } | undefined;
  return {
    prev: prev?.original_id ?? null,
    next: next?.original_id ?? null,
  };
}

export function searchMessages(
  query: string,
  newsgroup?: string,
  page: number = 1,
  perPage: number = 50
): { messages: Message[]; total: number } {
  const db = getDb();
  const ftsQuery = query
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(" ");

  if (newsgroup) {
    const total = (
      db
        .prepare(
          `SELECT COUNT(*) as c FROM messages_fts
           JOIN messages ON messages.rowid = messages_fts.rowid
           WHERE messages_fts MATCH ? AND messages.newsgroup = ?`
        )
        .get(ftsQuery, newsgroup) as { c: number }
    ).c;
    const messages = db
      .prepare(
        `SELECT messages.id, messages.newsgroup, messages.original_id,
                messages.from_addr, messages.date, messages.subject,
                messages.message_id,
                snippet(messages_fts, 0, '<mark class="highlight">', '</mark>', '...', 40) as body
         FROM messages_fts
         JOIN messages ON messages.rowid = messages_fts.rowid
         WHERE messages_fts MATCH ? AND messages.newsgroup = ?
         ORDER BY rank
         LIMIT ? OFFSET ?`
      )
      .all(ftsQuery, newsgroup, perPage, (page - 1) * perPage) as Message[];
    return { messages, total };
  }

  const total = (
    db
      .prepare(
        `SELECT COUNT(*) as c FROM messages_fts
         JOIN messages ON messages.rowid = messages_fts.rowid
         WHERE messages_fts MATCH ?`
      )
      .get(ftsQuery) as { c: number }
  ).c;
  const messages = db
    .prepare(
      `SELECT messages.id, messages.newsgroup, messages.original_id,
              messages.from_addr, messages.date, messages.subject,
              messages.message_id,
              snippet(messages_fts, 0, '<mark class="highlight">', '</mark>', '...', 40) as body
       FROM messages_fts
       JOIN messages ON messages.rowid = messages_fts.rowid
       WHERE messages_fts MATCH ?
       ORDER BY rank
       LIMIT ? OFFSET ?`
    )
    .all(ftsQuery, perPage, (page - 1) * perPage) as Message[];
  return { messages, total };
}
