import Database from "better-sqlite3";
import path from "path";
import type { ParsedQuery } from "./query";
import { HL_OPEN } from "./format";

const DB_PATH = process.env.USENET_DB ?? path.join(process.cwd(), "data", "usenet.db");

let _db: Database.Database | null = null;

function db(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    _db.pragma("query_only = ON");
    _db.pragma("cache_size = -131072"); // 128 MiB page cache
    _db.pragma("mmap_size = 2147483648"); // 2 GiB memory map
    _db.pragma("temp_store = MEMORY");
  }
  return _db;
}

// Prepared-statement cache: SQL text is the key.
const stmts = new Map<string, Database.Statement>();
function q(sql: string): Database.Statement {
  let s = stmts.get(sql);
  if (!s) {
    s = db().prepare(sql);
    stmts.set(sql, s);
  }
  return s;
}

export interface Newsgroup {
  name: string;
  message_count: number;
  first_date: string | null;
  last_date: string | null;
}

export interface MessageRow {
  id: number;
  newsgroup: string;
  original_id: number;
  from_addr: string;
  date: string;
  subject: string;
  message_id: string;
}

export interface Message extends MessageRow {
  body: string;
}

/* ------------------------------------------------------------------ groups */

let _groups: Newsgroup[] | null = null;
let _groupMap: Map<string, Newsgroup> | null = null;

/** All newsgroups (the archive is static, so this is cached for the process). */
export function getNewsgroups(): Newsgroup[] {
  if (!_groups) {
    _groups = q(
      `SELECT name, message_count,
              NULLIF(first_date, '') AS first_date,
              NULLIF(last_date, '')  AS last_date
       FROM newsgroups ORDER BY name`
    ).all() as Newsgroup[];
    _groupMap = new Map(_groups.map((g) => [g.name, g]));
  }
  return _groups;
}

export function getNewsgroup(name: string): Newsgroup | undefined {
  getNewsgroups();
  return _groupMap!.get(name);
}

export function getTotals(): { groups: number; messages: number } {
  const g = getNewsgroups();
  return { groups: g.length, messages: g.reduce((s, x) => s + x.message_count, 0) };
}

interface IdRange {
  lo: number;
  hi: number;
  /** every id in [lo, hi] belongs to this group */
  contiguous: boolean;
}
const ranges = new Map<string, IdRange>();

/** Row-id span of a group — lets FTS5 seek straight to it instead of joining. */
function groupRange(name: string): IdRange | null {
  const hit = ranges.get(name);
  if (hit) return hit;
  const g = getNewsgroup(name);
  if (!g) return null;
  const r = q(
    `SELECT (SELECT id FROM messages WHERE newsgroup = ? ORDER BY id ASC  LIMIT 1) AS lo,
            (SELECT id FROM messages WHERE newsgroup = ? ORDER BY id DESC LIMIT 1) AS hi`
  ).get(name, name) as { lo: number | null; hi: number | null };
  if (r.lo == null || r.hi == null) return null;
  const range = { lo: r.lo, hi: r.hi, contiguous: r.hi - r.lo + 1 === g.message_count };
  ranges.set(name, range);
  return range;
}

/* ---------------------------------------------------------------- messages */

const LIST_COLS = `id, newsgroup, original_id, from_addr, date, subject, message_id`;

export function getMessages(
  newsgroup: string,
  page: number,
  perPage = 50,
  order: "asc" | "desc" = "asc"
): { messages: MessageRow[]; total: number } {
  const total = getNewsgroup(newsgroup)?.message_count ?? 0;
  const dir = order === "desc" ? "DESC" : "ASC";
  const messages = q(
    `SELECT ${LIST_COLS} FROM messages
     WHERE newsgroup = ? ORDER BY original_id ${dir} LIMIT ? OFFSET ?`
  ).all(newsgroup, perPage, (page - 1) * perPage) as MessageRow[];
  return { messages, total };
}

export function getMessage(newsgroup: string, originalId: number): Message | undefined {
  return q(`SELECT * FROM messages WHERE newsgroup = ? AND original_id = ?`).get(
    newsgroup,
    originalId
  ) as Message | undefined;
}

export function getAdjacentIds(
  newsgroup: string,
  originalId: number
): { prev: number | null; next: number | null; position: number } {
  const prev = q(
    `SELECT original_id FROM messages WHERE newsgroup = ? AND original_id < ?
     ORDER BY original_id DESC LIMIT 1`
  ).get(newsgroup, originalId) as { original_id: number } | undefined;
  const next = q(
    `SELECT original_id FROM messages WHERE newsgroup = ? AND original_id > ?
     ORDER BY original_id ASC LIMIT 1`
  ).get(newsgroup, originalId) as { original_id: number } | undefined;
  const before = q(
    `SELECT COUNT(*) AS c FROM messages WHERE newsgroup = ? AND original_id < ?`
  ).get(newsgroup, originalId) as { c: number };
  return {
    prev: prev?.original_id ?? null,
    next: next?.original_id ?? null,
    position: before.c,
  };
}

/* ------------------------------------------------------------------ search */

let _hasMeta: boolean | null = null;
/** meta_fts is built by `npm run index:meta`; search degrades gracefully without it. */
export function hasMetaIndex(): boolean {
  if (_hasMeta === null) {
    _hasMeta = !!q(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta_fts'`
    ).get();
  }
  return _hasMeta;
}

export type SearchSort = "relevance" | "newest" | "oldest";

export interface SearchHit extends MessageRow {
  /** body excerpt; \u0002…\u0003 delimit highlighted spans */
  excerpt: string;
  /** subject/from with highlight markers when they matched */
  subjectHl?: string;
  fromHl?: string;
}

export interface SearchResult {
  hits: SearchHit[];
  total: number;
  /** total is a lower bound (counting was capped) */
  capped: boolean;
  /** requested sort could not be honoured (too many matches) */
  sortFallback: boolean;
  sort: SearchSort;
  ms: number;
  error?: string;
}

/** Result sets larger than this are not re-sorted by date (it would need a full join). */
const DATE_SORT_LIMIT = 100_000;
/** When counting needs a join against `messages`, stop counting here. */
const JOIN_COUNT_CAP = 10_000;


function cleanExcerpt(body: string): string {
  // First meaningful lines: skip blank, quoted, attribution and header-ish lines.
  const out: string[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith(">") || line.startsWith("|")) continue;
    if (/^(in article|on .{0,80} wrote:?$|.{0,80} writes:$)/i.test(line)) continue;
    out.push(line);
    if (out.join(" ").length > 260) break;
  }
  const s = out.join(" ");
  return s.length > 280 ? s.slice(0, 280).replace(/\s+\S*$/, "") + " …" : s;
}

export function searchMessages(
  pq: ParsedQuery,
  opts: { page: number; perPage: number; sort: SearchSort }
): SearchResult {
  const t0 = performance.now();
  const done = (r: Omit<SearchResult, "ms">): SearchResult => ({
    ...r,
    ms: performance.now() - t0,
  });
  const empty = { hits: [], total: 0, capped: false, sortFallback: false, sort: opts.sort };

  if (pq.error) return done({ ...empty, error: pq.error });

  const meta = hasMetaIndex();
  if (!meta && (pq.meta.pos || pq.meta.negOnly)) {
    return done({
      ...empty,
      error: "from: and subject: need the header index — run `npm run index:meta` once.",
    });
  }

  let groupFilter: string | null = null;
  let range: IdRange | null = null;
  if (pq.group) {
    if (!getNewsgroup(pq.group)) return done({ ...empty, error: `No newsgroup named “${pq.group}”.` });
    range = groupRange(pq.group);
    if (!range) return done(empty);
    if (!range.contiguous) groupFilter = pq.group;
  }

  // Pick the driving index: body if it has positive terms, else headers.
  const bodyDrives = !!pq.body.pos;
  const T = bodyDrives ? "messages_fts" : "meta_fts";
  const where: string[] = [`${T} MATCH ?`];
  const params: unknown[] = [bodyDrives ? pq.body.pos : pq.meta.pos];

  if (bodyDrives && pq.meta.pos) {
    where.push(`${T}.rowid IN (SELECT rowid FROM meta_fts WHERE meta_fts MATCH ?)`);
    params.push(pq.meta.pos);
  }
  if (!bodyDrives && pq.body.negOnly) {
    where.push(`${T}.rowid NOT IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)`);
    params.push(pq.body.negOnly);
  }
  if (pq.meta.negOnly) {
    where.push(`${T}.rowid NOT IN (SELECT rowid FROM meta_fts WHERE meta_fts MATCH ?)`);
    params.push(pq.meta.negOnly);
  }
  if (range) {
    where.push(`${T}.rowid BETWEEN ? AND ?`);
    params.push(range.lo, range.hi);
  }

  const joinConds: string[] = [];
  const joinParams: unknown[] = [];
  if (groupFilter) {
    joinConds.push(`m.newsgroup = ?`);
    joinParams.push(groupFilter);
  }
  if (pq.after) {
    joinConds.push(`m.date >= ?`);
    joinParams.push(pq.after);
  }
  if (pq.before) {
    joinConds.push(`m.date < ? AND m.date <> ''`);
    joinParams.push(pq.before);
  }
  const filterJoin = joinConds.length > 0;

  const from = (join: boolean) =>
    `FROM ${T}${join ? ` JOIN messages m ON m.id = ${T}.rowid` : ""}
     WHERE ${where.join(" AND ")}${join && joinConds.length ? ` AND ${joinConds.join(" AND ")}` : ""}`;

  try {
    // ---- count
    let total: number;
    let capped = false;
    if (filterJoin) {
      total = (
        q(`SELECT COUNT(*) AS c FROM (SELECT 1 ${from(true)} LIMIT ${JOIN_COUNT_CAP + 1})`).get(
          ...params,
          ...joinParams
        ) as { c: number }
      ).c;
      if (total > JOIN_COUNT_CAP) {
        total = JOIN_COUNT_CAP;
        capped = true;
      }
    } else {
      total = (q(`SELECT COUNT(*) AS c ${from(false)}`).get(...params) as { c: number }).c;
    }
    if (total === 0) return done({ ...empty, total: 0 });

    // ---- sort
    let sort = opts.sort;
    let sortFallback = false;
    if (sort !== "relevance" && (capped || total > DATE_SORT_LIMIT)) {
      sort = "relevance";
      sortFallback = true;
    }
    const needJoin = filterJoin || sort !== "relevance";
    const order =
      sort === "newest"
        ? `ORDER BY (m.date = '') ASC, m.date DESC, m.id DESC`
        : sort === "oldest"
          ? `ORDER BY (m.date = '') ASC, m.date ASC, m.id ASC`
          : `ORDER BY ${T}.rank`;

    const ids = (
      q(`SELECT ${T}.rowid AS id ${from(needJoin)} ${order} LIMIT ? OFFSET ?`).all(
        ...params,
        ...(needJoin ? joinParams : []),
        opts.perPage,
        (opts.page - 1) * opts.perPage
      ) as { id: number }[]
    ).map((r) => r.id);
    if (ids.length === 0) return done({ ...empty, total, capped, sortFallback, sort });

    // ---- hydrate (only the rows on this page)
    const rowStmt = q(`SELECT ${LIST_COLS}, substr(body, 1, 1500) AS head FROM messages WHERE id = ?`);
    const snipStmt = pq.body.pos
      ? q(
          `SELECT snippet(messages_fts, 0, char(2), char(3), ' … ', 32) AS s
           FROM messages_fts WHERE messages_fts MATCH ? AND rowid = ?`
        )
      : null;
    const hlStmt =
      meta && pq.meta.pos
        ? q(
            `SELECT highlight(meta_fts, 0, char(2), char(3)) AS s,
                    highlight(meta_fts, 1, char(2), char(3)) AS f
             FROM meta_fts WHERE meta_fts MATCH ? AND rowid = ?`
          )
        : null;

    const hits: SearchHit[] = ids.map((id) => {
      const row = rowStmt.get(id) as MessageRow & { head: string };
      const { head, ...rest } = row;
      const hit: SearchHit = { ...rest, excerpt: "" };
      if (snipStmt) {
        const s = snipStmt.get(pq.body.pos, id) as { s: string } | undefined;
        hit.excerpt = (s?.s ?? "").replace(/\s+/g, " ").trim();
      }
      if (!hit.excerpt) hit.excerpt = cleanExcerpt(head);
      if (hlStmt) {
        const h = hlStmt.get(pq.meta.pos, id) as { s: string; f: string } | undefined;
        if (h?.s?.includes(HL_OPEN)) hit.subjectHl = h.s;
        if (h?.f?.includes(HL_OPEN)) hit.fromHl = h.f;
      }
      return hit;
    });

    return done({ hits, total, capped, sortFallback, sort });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return done({ ...empty, error: `Search failed: ${msg}` });
  }
}
