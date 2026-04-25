# usenet

A suckless Usenet newsgroup archive viewer built with Next.js and SQLite.

Renders 854,000+ messages from 12 newsgroups (1981-2014) with a Plan 9 aesthetic. Full-text search via FTS5. No JavaScript frameworks, no client-side bloat — server-rendered pages with plain CSS.

## Features

- Browse newsgroups with paginated message listings
- Read individual posts with quote-level coloring
- Full-text search across all groups or scoped to one
- Prev/next navigation between messages
- Import pipeline that cleans and splits raw Google Groups / NNTP dumps

## Architecture

- **Next.js 16** — App Router, server components only, no client JS
- **SQLite + better-sqlite3** — Single-file database with FTS5 full-text search
- **Plan 9 aesthetic** — IBM Plex Mono, cyan/tan/beige window chrome inspired by acme/rio

## Data

The import script handles:
- **Clean JSON** (e.g. comp.os.minix with proper per-message metadata)
- **Concatenated Google Groups blobs** — hundreds of posts mashed into single JSON entries, split on `From <id>` boundaries with NNTP header extraction
- **Deduplication** by Message-ID
- **Date normalization** from RFC 2822 and ISO formats

Currently imported groups span alt.folklore.computers, comp.lang.c, comp.lang.lisp, comp.os.minix, comp.sources.unix, comp.unix.wizards, net.general, net.micro.apple, net.news, net.unix-wizards, news.announce.newgroups, and sci.math.

## Usage

```bash
# Import archive data into SQLite
npm run import /path/to/usenet/archive

# Re-split concatenated blobs (if importing raw Google Groups data)
npx tsx scripts/resplit.ts

# Run dev server
npm run dev

# Production
npm run build && npm start
```

## Schema

```sql
CREATE TABLE newsgroups (
  name TEXT PRIMARY KEY,
  message_count INTEGER,
  first_date TEXT,
  last_date TEXT
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  newsgroup TEXT NOT NULL,
  original_id INTEGER NOT NULL,
  from_addr TEXT,
  date TEXT,
  subject TEXT,
  message_id TEXT,
  body TEXT
);

CREATE VIRTUAL TABLE messages_fts USING fts5(body, content='messages', content_rowid='id');
```

## License

Public domain.
