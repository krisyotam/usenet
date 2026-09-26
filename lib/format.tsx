import type { ReactNode } from "react";

export const HL_OPEN = "\u0002";
export const HL_CLOSE = "\u0003";

/** Route params arrive percent-encoded (group names contain @, spaces, commas…). */
export function decodeParam(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export const groupHref = (name: string, qs = "") =>
  `/group/${encodeURIComponent(name)}${qs}`;

export const messageHref = (name: string, originalId: number) =>
  `/group/${encodeURIComponent(name)}/${originalId}`;

export function searchHref(params: Record<string, string | number | undefined | null>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `/search?${s}` : "/search";
}

/** Quote a value for use inside a query (from:"Rob Pike"). */
export function queryValue(v: string): string {
  const clean = v.replace(/"/g, " ").replace(/\s+/g, " ").trim();
  return /\s/.test(clean) ? `"${clean}"` : clean;
}

export const fmt = (n: number) => n.toLocaleString("en-US");

export function fmtDate(d: string | null | undefined): string {
  return d ? d : "—";
}

export function intParam(v: string | undefined, fallback = 1): number {
  const n = parseInt(v ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Render text containing \u0002…\u0003 highlight markers as <mark>. */
export function Highlight({ text }: { text: string }): ReactNode {
  if (!text.includes(HL_OPEN)) return text;
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < text.length) {
    const a = text.indexOf(HL_OPEN, i);
    if (a === -1) {
      out.push(text.slice(i));
      break;
    }
    if (a > i) out.push(text.slice(i, a));
    const b = text.indexOf(HL_CLOSE, a + 1);
    const end = b === -1 ? text.length : b;
    out.push(<mark key={k++}>{text.slice(a + 1, end)}</mark>);
    i = end + 1;
  }
  return out;
}

/** Pull the human name out of "addr (Name)" / "Name <addr>" / bare address. */
export function authorName(from: string): string {
  const paren = from.match(/\(([^)]+)\)\s*$/);
  if (paren) return paren[1].trim();
  const angle = from.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/);
  if (angle) return angle[1].trim();
  return from.trim();
}

export function authorAddress(from: string): string {
  const angle = from.match(/<([^>]+)>/);
  if (angle) return angle[1];
  const bare = from.match(/[^\s()<>"]+@[^\s()<>"]+/);
  if (bare) return bare[0];
  const bang = from.match(/^[^\s()]+![^\s()]+/); // uucp paths
  if (bang) return bang[0];
  return "";
}

/* ------------------------------------------------------------ message body */

const URL_RE = /\b(?:https?|ftp):\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]}]/g;

function linkify(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(URL_RE)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    out.push(
      <a key={`${keyBase}-${k++}`} href={m[0]} rel="noopener noreferrer nofollow" target="_blank">
        {m[0]}
      </a>
    );
    last = i + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function lineClass(line: string, inSig: boolean): string {
  if (inSig) return "sig";
  const m = line.match(/^((?:\s?[>|])+)/);
  if (m) {
    const depth = (m[1].match(/[>|]/g) ?? []).length;
    return `q${((depth - 1) % 3) + 1}`;
  }
  if (/^in article <[^>]*>.*writes:\s*$/i.test(line) || /^.{1,100} (writes|wrote):\s*$/.test(line))
    return "attr";
  return "";
}

/**
 * Message body → spans grouped by line class (quote depth, attribution,
 * signature). Consecutive lines with the same class share one span so huge
 * posts don't turn into tens of thousands of nodes.
 */
export function formatBody(body: string): ReactNode[] {
  const lines = body.replace(/\r\n?/g, "\n").replace(/\s+$/, "").split("\n");
  const out: ReactNode[] = [];
  let inSig = false;
  let cls: string | null = null;
  let buf: string[] = [];
  let k = 0;
  const flush = () => {
    if (!buf.length) return;
    const text = buf.join("\n") + "\n";
    const key = `b${k++}`;
    const kids = linkify(text, key);
    out.push(cls ? <span key={key} className={cls}>{kids}</span> : <span key={key}>{kids}</span>);
    buf = [];
  };
  for (const line of lines) {
    if (!inSig && (line === "-- " || line === "--")) inSig = true;
    const c = lineClass(line, inSig);
    if (c !== cls) {
      flush();
      cls = c;
    }
    buf.push(line);
  }
  flush();
  return out;
}

/* -------------------------------------------------------------- hierarchy */

/** Top-level hierarchy of a group name; crossposted/garbled names go to "misc". */
export function hierarchyOf(name: string): string {
  if (/[\s,@^]/.test(name)) return "(crossposts & strays)";
  const dot = name.indexOf(".");
  return dot === -1 ? "(top-level)" : name.slice(0, dot);
}

/* ------------------------------------------------- RFC 2047 encoded words */

const ENCODED_WORD = /=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/g;

/** Decode MIME encoded-words (=?utf-8?b?…?=) in headers; leaves anything malformed alone. */
export function decodeMime(s: string): string {
  if (!s || !s.includes("=?")) return s;
  return s
    .replace(/(\?=)\s+(=\?)/g, "$1$2") // whitespace between adjacent encoded words is dropped
    .replace(ENCODED_WORD, (whole, charset: string, enc: string, text: string) => {
      try {
        const bytes =
          enc.toUpperCase() === "B"
            ? Buffer.from(text, "base64")
            : Buffer.from(
                text
                  .replace(/_/g, " ")
                  .replace(/=([0-9A-Fa-f]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16))),
                "latin1"
              );
        return new TextDecoder(charset.split("*")[0].toLowerCase(), { fatal: false }).decode(bytes);
      } catch {
        return whole;
      }
    });
}
