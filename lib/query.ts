/**
 * Search query parser.
 *
 * Turns a user query into FTS5 expressions for the two indexes:
 *   messages_fts(body)            — free text
 *   meta_fts(subject, from_addr)  — subject: / from: terms
 *
 * Syntax
 *   word            must contain word
 *   "a phrase"      exact phrase
 *   pref*           prefix match
 *   -word           exclude (also -"phrase", -from:x)
 *   a OR b          either term
 *   from:pike       author (name or address)       aliases: f:, by:, author:
 *   subject:plan9   subject line                   aliases: s:, subj:, title:
 *   group:comp.os.plan9   one newsgroup            aliases: g:, in:
 *   after:1990  before:1995-06   date bounds (YYYY, YYYY-MM, YYYY-MM-DD)
 */

export type Field = "body" | "subject" | "from_addr";

export interface IndexExpr {
  /** FTS5 expression for positive terms (NOT clauses folded in), or "" */
  pos: string;
  /** FTS5 expression of rows to exclude when this index has no positives, or "" */
  negOnly: string;
}

export interface ParsedQuery {
  body: IndexExpr;
  meta: IndexExpr;
  group?: string;
  after?: string; // inclusive lower bound, YYYY-MM-DD
  before?: string; // exclusive upper bound, YYYY-MM-DD
  /** Positive plain terms, for echoing back to the user. */
  terms: string[];
  error?: string;
}

interface Term {
  neg: boolean;
  text: string; // valid FTS5 phrase, possibly column-qualified
}

type Special = "group" | "after" | "before";

const FIELD_ALIASES: Record<string, Field | Special> = {
  from: "from_addr",
  f: "from_addr",
  author: "from_addr",
  by: "from_addr",
  subject: "subject",
  subj: "subject",
  s: "subject",
  title: "subject",
  group: "group",
  g: "group",
  in: "group",
  newsgroup: "group",
  after: "after",
  since: "after",
  before: "before",
  until: "before",
};

const HAS_WORD = /[\p{L}\p{N}]/u;

function phrase(raw: string): string | null {
  let prefix = false;
  let s = raw;
  if (s.endsWith("*")) {
    prefix = true;
    s = s.replace(/\*+$/, "");
  }
  if (!HAS_WORD.test(s)) return null;
  return `"${s.replace(/"/g, '""')}"${prefix ? "*" : ""}`;
}

/** Normalise YYYY / YYYY-MM / YYYY-MM-DD. `end` rounds up to the start of the next period. */
export function parseDate(v: string, end: boolean): string | null {
  const m = v.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
  if (!m) return null;
  const y = +m[1];
  const mo = m[2] ? +m[2] : 1;
  const d = m[3] ? +m[3] : 1;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  let dt = new Date(Date.UTC(y, mo - 1, d));
  if (end) {
    if (m[3]) dt = new Date(Date.UTC(y, mo - 1, d + 1));
    else if (m[2]) dt = new Date(Date.UTC(y, mo, 1));
    else dt = new Date(Date.UTC(y + 1, 0, 1));
  }
  return dt.toISOString().slice(0, 10);
}

function buildExpr(terms: Term[], orAfter: Set<number>): IndexExpr {
  const pos: string[] = [];
  const neg: string[] = [];
  let cur: string[] = [];
  const flush = () => {
    if (cur.length) pos.push(cur.length > 1 ? `(${cur.join(" OR ")})` : cur[0]);
    cur = [];
  };
  terms.forEach((t, i) => {
    if (t.neg) {
      neg.push(t.text);
      return;
    }
    cur.push(t.text);
    if (!orAfter.has(i)) flush();
  });
  flush();

  const negExpr = neg.length > 1 ? `(${neg.join(" OR ")})` : (neg[0] ?? "");
  if (pos.length) {
    const p = pos.length > 1 ? pos.join(" AND ") : pos[0];
    return { pos: negExpr ? `(${p}) NOT ${negExpr}` : p, negOnly: "" };
  }
  return { pos: "", negOnly: negExpr };
}

export function parseQuery(input: string): ParsedQuery {
  const re = /(-)?(?:([A-Za-z_]+):)?(?:"([^"]*)"?|(\S+))/g;
  const out: ParsedQuery = {
    body: { pos: "", negOnly: "" },
    meta: { pos: "", negOnly: "" },
    terms: [],
  };
  const body: Term[] = [];
  const meta: Term[] = [];
  const bodyOr = new Set<number>();
  const metaOr = new Set<number>();
  let pendingOr = false;
  let lastList: Term[] | null = null;

  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    if (m[0] === "") {
      re.lastIndex++;
      continue;
    }
    const [, minus, rawField, quoted, bare] = m;
    const neg = !!minus;
    const value = quoted ?? bare ?? "";

    if (!rawField && quoted === undefined && !neg && (value === "OR" || value === "|")) {
      pendingOr = true;
      continue;
    }

    const alias = rawField ? FIELD_ALIASES[rawField.toLowerCase()] : undefined;
    // Unknown "foo:bar" (a URL, "Re:") is just text.
    const text = rawField && !alias ? `${rawField}:${value}` : value;

    if (alias === "group") {
      if (value) out.group = value;
      pendingOr = false;
      continue;
    }
    if (alias === "after" || alias === "before") {
      const d = parseDate(value, alias === "before");
      if (!d) out.error = `Bad date “${value}” — use YYYY, YYYY-MM or YYYY-MM-DD.`;
      else if (alias === "after") out.after = d;
      else out.before = d;
      pendingOr = false;
      continue;
    }

    const ph = phrase(text);
    if (!ph) {
      pendingOr = false;
      continue;
    }
    const field: Field = (alias as Field | undefined) ?? "body";
    const isMeta = field !== "body";
    const list = isMeta ? meta : body;
    const orSet = isMeta ? metaOr : bodyOr;

    // OR links two positive terms that land in the same index.
    if (pendingOr && !neg && lastList === list && list.length && !list[list.length - 1].neg) {
      orSet.add(list.length - 1);
    }
    list.push({ neg, text: isMeta ? `${field} : ${ph}` : ph });
    lastList = list;
    pendingOr = false;
    if (!neg) out.terms.push(text.replace(/\*+$/, ""));
  }

  out.body = buildExpr(body, bodyOr);
  out.meta = buildExpr(meta, metaOr);

  if (!out.error && !out.body.pos && !out.meta.pos) {
    if (out.body.negOnly || out.meta.negOnly)
      out.error = "Exclusions need something to exclude from — add a word, phrase, from: or subject: term.";
    else if (out.group || out.after || out.before)
      out.error = "Add a word, phrase, from: or subject: term to search within that filter.";
  }
  if (!out.error && out.after && out.before && out.after >= out.before)
    out.error = "after: must be earlier than before:.";
  return out;
}
