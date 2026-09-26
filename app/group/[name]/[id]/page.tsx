import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getMessage, getAdjacentIds } from "@/lib/db";
import {
  authorAddress,
  authorName,
  decodeMime,
  decodeParam,
  fmtDate,
  formatBody,
  groupHref,
  messageHref,
  queryValue,
  searchHref,
} from "@/lib/format";
import { Window, Sep } from "@/components/Window";

const PER_PAGE = 50;

interface Props {
  params: Promise<{ name: string; id: string }>;
}

async function load(params: Props["params"]) {
  const p = await params;
  const name = decodeParam(p.name);
  if (!/^\d+$/.test(p.id)) return null;
  const originalId = parseInt(p.id, 10);
  const message = getMessage(name, originalId);
  return message ? { name, originalId, message } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const r = await load(params);
  if (!r) return { title: "not found" };
  return {
    title: `${decodeMime(r.message.subject) || "(no subject)"} — ${r.name}`,
    description: `${authorName(decodeMime(r.message.from_addr))} · ${r.message.date || "undated"}`,
  };
}

/** Thread key: the subject without Re:/Fwd: prefixes and [list] tags. */
function threadSubject(s: string): string {
  let t = s.trim();
  for (;;) {
    const n = t.replace(/^\s*((re|fwd?|aw|sv)(\[\d+\])?\s*:|\[[^\]]{1,40}\])\s*/i, "");
    if (n === t) break;
    t = n;
  }
  return t.replace(/\s*\(was:.*\)\s*$/i, "").trim();
}

export default async function MessagePage({ params }: Props) {
  const r = await load(params);
  if (!r) notFound();
  const { name, originalId } = r;
  const message = {
    ...r.message,
    subject: decodeMime(r.message.subject),
    from_addr: decodeMime(r.message.from_addr),
  };
  const { prev, next, position } = getAdjacentIds(name, originalId);
  const indexPage = Math.floor(position / PER_PAGE) + 1;
  const indexHref = groupHref(name, indexPage > 1 ? `?page=${indexPage}` : "");

  const addr = authorAddress(message.from_addr);
  const who = authorName(message.from_addr);
  const authorQuery = addr || who;
  const thread = threadSubject(message.subject);

  return (
    <Window
      path={`/usr/usenet/${name}/${originalId}`}
      meta={<>#{originalId}</>}
      crumbs={
        <>
          <Sep />
          <Link href={indexHref}>{name}</Link>
          <Sep />
          <span className="here">{originalId}</span>
        </>
      }
    >
      <dl className="p9-headers">
        <dt>From:</dt>
        <dd>
          {message.from_addr || "(unknown)"}
          {authorQuery && (
            <span className="acts">
              <Link href={searchHref({ q: `from:${queryValue(authorQuery)}`, group: name, sort: "newest" })}>
                posts here
              </Link>{" "}
              ·{" "}
              <Link href={searchHref({ q: `from:${queryValue(authorQuery)}`, sort: "newest" })}>
                everywhere
              </Link>
            </span>
          )}
        </dd>
        <dt>Date:</dt>
        <dd>{fmtDate(message.date)}</dd>
        <dt>Newsgroup:</dt>
        <dd>
          <Link href={indexHref}>{name}</Link>
        </dd>
        <dt>Subject:</dt>
        <dd>
          <span className="subject">{message.subject || "(no subject)"}</span>
          {thread && (
            <span className="acts">
              <Link href={searchHref({ q: `subject:${queryValue(thread)}`, group: name, sort: "oldest" })}>
                thread
              </Link>
            </span>
          )}
        </dd>
        {message.message_id && (
          <>
            <dt>Message-ID:</dt>
            <dd>{message.message_id}</dd>
          </>
        )}
      </dl>

      <pre className="p9-msg-body">
        {message.body.trim() ? formatBody(message.body) : <span className="dim">(empty body)</span>}
      </pre>

      <nav className="p9-msg-nav" aria-label="Message navigation">
        {prev !== null ? (
          <Link href={messageHref(name, prev)} rel="prev">
            &#9666; prev
          </Link>
        ) : (
          <span className="dim">&#9666; prev</span>
        )}
        <Link href={indexHref} rel="up">
          index
        </Link>
        {next !== null ? (
          <Link href={messageHref(name, next)} rel="next" className="right">
            next &#9656;
          </Link>
        ) : (
          <span className="right dim">next &#9656;</span>
        )}
      </nav>
    </Window>
  );
}
