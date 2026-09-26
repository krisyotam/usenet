import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getNewsgroup, getMessages } from "@/lib/db";
import {
  decodeParam,
  fmt,
  fmtDate,
  groupHref,
  hierarchyOf,
  intParam,
  messageHref,
  decodeMime,
} from "@/lib/format";
import { Window, Sep } from "@/components/Window";
import { Pager } from "@/components/Pager";

const PER_PAGE = 50;

interface Props {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ page?: string; order?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const name = decodeParam((await params).name);
  return { title: name };
}

export default async function GroupPage({ params, searchParams }: Props) {
  const name = decodeParam((await params).name);
  const sp = await searchParams;
  const group = getNewsgroup(name);
  if (!group) notFound();

  const order = sp.order === "desc" ? "desc" : "asc";
  const totalPages = Math.max(1, Math.ceil(group.message_count / PER_PAGE));
  const page = Math.min(intParam(sp.page), totalPages);
  const { messages } = getMessages(name, page, PER_PAGE, order);

  const hrefFor = (p: number, o = order) => {
    const qs = new URLSearchParams();
    if (p > 1) qs.set("page", String(p));
    if (o === "desc") qs.set("order", "desc");
    const s = qs.toString();
    return groupHref(name, s ? `?${s}` : "");
  };
  const hier = hierarchyOf(name);
  const from = (page - 1) * PER_PAGE + 1;
  const to = Math.min(group.message_count, page * PER_PAGE);

  return (
    <Window
      path={`/usr/usenet/${name}`}
      meta={
        <>
          {fmt(group.message_count)} messages · {fmtDate(group.first_date)} – {fmtDate(group.last_date)}
        </>
      }
      crumbs={
        <>
          <Sep />
          <Link href={`/?h=${encodeURIComponent(hier)}`} rel="up">
            {hier}
          </Link>
          <Sep />
          <span className="here">{name}</span>
        </>
      }
    >
      <div className="p9-bar">
        <form className="p9-search" action="/search" method="GET" role="search">
          <input type="hidden" name="group" value={name} />
          <label htmlFor="q">search {name}</label>
          <input id="q" type="search" name="q" placeholder="words, from:, subject:…" data-search autoComplete="off" />
          <button type="submit">find</button>
        </form>
        <span className="p9-opts">
          <Link href={hrefFor(1, "asc")} className={order === "asc" ? "on" : undefined}>
            oldest first
          </Link>
          <Link href={hrefFor(1, "desc")} className={order === "desc" ? "on" : undefined}>
            newest first
          </Link>
        </span>
      </div>

      {messages.length === 0 ? (
        <div className="p9-empty">No messages on this page.</div>
      ) : (
        <table className="p9-table">
          <thead>
            <tr>
              <th className="col-num">#</th>
              <th>subject</th>
              <th className="col-from">from</th>
              <th className="col-date">date</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((m) => (
              <tr key={m.id}>
                <td className="col-num">{m.original_id}</td>
                <td className="col-subj">
                  <Link href={messageHref(name, m.original_id)}>{decodeMime(m.subject) || "(no subject)"}</Link>
                </td>
                <td className="col-from" title={decodeMime(m.from_addr)}>
                  {decodeMime(m.from_addr) || "—"}
                </td>
                <td className="col-date">{fmtDate(m.date)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Pager
        page={page}
        totalPages={totalPages}
        href={(p) => hrefFor(p)}
        action={groupHref(name)}
        hidden={{ order: order === "desc" ? "desc" : undefined }}
        label={`${fmt(from)}–${fmt(to)} of ${fmt(group.message_count)}`}
      />
    </Window>
  );
}
