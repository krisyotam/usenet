import type { Metadata } from "next";
import Link from "next/link";
import { searchMessages, hasMetaIndex, type SearchSort } from "@/lib/db";
import { parseQuery } from "@/lib/query";
import {
  Highlight,
  authorAddress,
  authorName,
  decodeMime,
  fmt,
  fmtDate,
  groupHref,
  intParam,
  messageHref,
  queryValue,
  searchHref,
} from "@/lib/format";
import { Window, Sep } from "@/components/Window";
import { Pager } from "@/components/Pager";

const PER_PAGE = 25;
const MAX_PAGE = 400; // deep OFFSETs on relevance order are not worth the cost

interface Props {
  searchParams: Promise<{ q?: string; group?: string; page?: string; sort?: string }>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = await searchParams;
  return { title: q ? `“${q}”` : "search" };
}

function Examples() {
  const ex: [string, string][] = [
    ['"rob pike" plan9', "phrase + word"],
    ["from:ritchie", "posts by an author"],
    ["subject:minix after:1991 before:1992", "subject in a date range"],
    ["lisp macro* -scheme", "prefix, exclusion"],
    ["group:comp.os.plan9 acme OR sam", "one group, either word"],
  ];
  return (
    <div className="p9-doc">
      <h2>examples</h2>
      <table>
        <tbody>
          {ex.map(([q, d]) => (
            <tr key={q}>
              <td>
                <Link href={searchHref({ q })}>
                  <code>{q}</code>
                </Link>
              </td>
              <td className="dim">{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="p9-hint">
        Full syntax on the <Link href="/help">help</Link> page.
      </p>
    </div>
  );
}

export default async function SearchPage({ searchParams }: Props) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const scopeGroup = sp.group?.trim() || undefined;
  const sortReq: SearchSort =
    sp.sort === "newest" || sp.sort === "oldest" ? sp.sort : "relevance";
  const page = Math.min(intParam(sp.page), MAX_PAGE);

  const pq = q ? parseQuery(q) : null;
  if (pq && scopeGroup && !pq.group) pq.group = scopeGroup;
  const group = pq?.group ?? scopeGroup;

  const res = pq ? searchMessages(pq, { page, perPage: PER_PAGE, sort: sortReq }) : null;
  const totalPages = res ? Math.min(MAX_PAGE, Math.ceil(res.total / PER_PAGE)) : 0;

  const hrefFor = (p: number) =>
    searchHref({
      q,
      group: scopeGroup,
      sort: sortReq === "relevance" ? undefined : sortReq,
      page: p > 1 ? p : undefined,
    });

  const meta = res && !res.error
    ? `${res.capped ? "over " : ""}${fmt(res.total)} ${res.total === 1 ? "result" : "results"} · ${(res.ms / 1000).toFixed(2)}s`
    : undefined;

  return (
    <Window
      path="/usr/usenet/search"
      meta={meta}
      crumbs={
        <>
          <Sep />
          {group ? (
            <>
              <Link href="/search">search</Link>
              <Sep />
              <Link href={groupHref(group)} rel="up">
                {group}
              </Link>
            </>
          ) : (
            <span className="here">search</span>
          )}
        </>
      }
    >
      <div className="p9-bar">
        <form className="p9-search" action="/search" method="GET" role="search">
          <label htmlFor="q" className="visually-hidden">
            query
          </label>
          <input
            id="q"
            type="search"
            name="q"
            defaultValue={q}
            placeholder='words, "phrases", from:pike, subject:plan9, after:1990'
            autoFocus={!q}
            data-search
            autoComplete="off"
          />
          {scopeGroup && (
            <select name="group" defaultValue={scopeGroup} aria-label="Scope">
              <option value={scopeGroup}>in {scopeGroup}</option>
              <option value="">all groups</option>
            </select>
          )}
          <select name="sort" defaultValue={sortReq} aria-label="Sort">
            <option value="relevance">best match</option>
            <option value="newest">newest</option>
            <option value="oldest">oldest</option>
          </select>
          <button type="submit">find</button>
        </form>
      </div>

      {!q && <Examples />}

      {res?.error && <div className="p9-error">{res.error}</div>}

      {res && !res.error && (
        <>
          {(res.sortFallback || res.capped || !hasMetaIndex()) && (
            <div className="p9-status">
              {res.sortFallback && (
                <span className="warn">
                  Too many matches to sort by date — showing best matches. Narrow the query (add
                  words, group:, after:/before:) to sort by date.
                </span>
              )}
              {res.capped && !res.sortFallback && <span>Counting stopped at {fmt(res.total)}.</span>}
              {!hasMetaIndex() && <span>Header index missing — run npm run index:meta.</span>}
            </div>
          )}

          {res.hits.length === 0 ? (
            <div className="p9-empty">
              {res.total > 0 ? (
                <>
                  Past the last page. <Link href={hrefFor(1)}>Back to page 1</Link>
                </>
              ) : (
                <>
                  No messages match <b>{q}</b>
                  {group ? <> in {group}</> : null}.
                  {group && scopeGroup && (
                    <>
                      {" "}
                      <Link href={searchHref({ q, sort: sortReq === "relevance" ? undefined : sortReq })}>
                        Try all groups →
                      </Link>
                    </>
                  )}
                </>
              )}
            </div>
          ) : (
            <ol className="p9-hits" start={(page - 1) * PER_PAGE + 1}>
              {res.hits.map((h) => {
                const who = authorName(decodeMime(h.from_addr));
                const authorKey = authorAddress(h.from_addr) || who;
                return (
                  <li key={h.id}>
                    <Link className="subj" href={messageHref(h.newsgroup, h.original_id)}>
                      {h.subjectHl ? <Highlight text={decodeMime(h.subjectHl)} /> : decodeMime(h.subject) || "(no subject)"}
                    </Link>
                    <div className="meta">
                      <Link href={groupHref(h.newsgroup)}>{h.newsgroup}</Link>
                      <span>{fmtDate(h.date)}</span>
                      {h.from_addr && (
                        <Link
                          href={searchHref({ q: `from:${queryValue(authorKey)}`, sort: "newest" })}
                          title={h.from_addr}
                        >
                          {h.fromHl ? <Highlight text={decodeMime(h.fromHl)} /> : who}
                        </Link>
                      )}
                    </div>
                    {h.excerpt && (
                      <p className="excerpt">
                        <Highlight text={h.excerpt} />
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}

          {totalPages > 1 && (
            <Pager
              page={page}
              totalPages={totalPages}
              href={hrefFor}
              action="/search"
              hidden={{
                q,
                group: scopeGroup,
                sort: sortReq === "relevance" ? undefined : sortReq,
              }}
            />
          )}
        </>
      )}
    </Window>
  );
}
