import type { Metadata } from "next";
import Link from "next/link";
import { getNewsgroups, getTotals, type Newsgroup } from "@/lib/db";
import { fmt, fmtDate, groupHref, hierarchyOf } from "@/lib/format";
import { Window, Sep } from "@/components/Window";

type SortKey = "name" | "messages" | "first" | "last";
type View = "hier" | "all" | "top";

interface Props {
  searchParams: Promise<{ q?: string; h?: string; sort?: string; view?: string }>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { h, q } = await searchParams;
  if (h) return { title: `${h}.*` };
  if (q) return { title: `groups matching “${q}”` };
  return {};
}

const SORTS: Record<SortKey, (a: Newsgroup, b: Newsgroup) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  messages: (a, b) => b.message_count - a.message_count || a.name.localeCompare(b.name),
  first: (a, b) =>
    (a.first_date ?? "9999").localeCompare(b.first_date ?? "9999") || a.name.localeCompare(b.name),
  last: (a, b) =>
    (b.last_date ?? "").localeCompare(a.last_date ?? "") || a.name.localeCompare(b.name),
};

function homeHref(p: { q?: string; h?: string; sort?: string; view?: string }) {
  const sp = new URLSearchParams();
  if (p.view && p.view !== "hier") sp.set("view", p.view);
  if (p.h) sp.set("h", p.h);
  if (p.q) sp.set("q", p.q);
  if (p.sort && p.sort !== "name") sp.set("sort", p.sort);
  const s = sp.toString();
  return s ? `/?${s}` : "/";
}

interface Hier {
  name: string;
  groups: number;
  messages: number;
  first: string | null;
  last: string | null;
}

function hierarchies(groups: Newsgroup[]): Hier[] {
  const m = new Map<string, Hier>();
  for (const g of groups) {
    const k = hierarchyOf(g.name);
    let h = m.get(k);
    if (!h) m.set(k, (h = { name: k, groups: 0, messages: 0, first: null, last: null }));
    h.groups++;
    h.messages += g.message_count;
    if (g.first_date && (!h.first || g.first_date < h.first)) h.first = g.first_date;
    if (g.last_date && (!h.last || g.last_date > h.last)) h.last = g.last_date;
  }
  return [...m.values()].sort((a, b) => b.messages - a.messages || a.name.localeCompare(b.name));
}

function GroupTable({
  groups,
  sort,
  linkFor,
}: {
  groups: Newsgroup[];
  sort: SortKey;
  linkFor: (s: SortKey) => string;
}) {
  const max = groups.reduce((m, g) => Math.max(m, g.message_count), 1);
  const th = (key: SortKey, label: string) => (
    <Link href={linkFor(key)} className={sort === key ? "on" : undefined}>
      {label}
      {sort === key ? " ▾" : ""}
    </Link>
  );
  return (
    <table className="p9-table">
      <thead>
        <tr>
          <th>{th("name", "newsgroup")}</th>
          <th className="col-count">{th("messages", "messages")}</th>
          <th className="col-date">{th("first", "first")}</th>
          <th className="col-date">{th("last", "last")}</th>
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => (
          <tr key={g.name}>
            <td className="col-subj">
              <Link href={groupHref(g.name)}>{g.name}</Link>
            </td>
            <td className="col-count bar-cell">
              <i
                className="bar"
                style={{ width: `${Math.max(1, (100 * Math.log10(g.message_count + 1)) / Math.log10(max + 1))}%` }}
              />
              <span>{fmt(g.message_count)}</span>
            </td>
            <td className="col-date">{fmtDate(g.first_date)}</td>
            <td className="col-date">{fmtDate(g.last_date)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function Home({ searchParams }: Props) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const h = sp.h?.trim() || undefined;
  const sort: SortKey = (["name", "messages", "first", "last"] as const).includes(sp.sort as SortKey)
    ? (sp.sort as SortKey)
    : "name";
  const view: View = sp.view === "all" || sp.view === "top" ? sp.view : "hier";

  const all = getNewsgroups();
  const totals = getTotals();

  let body: React.ReactNode;
  let crumbs: React.ReactNode = null;
  let meta = `${fmt(totals.groups)} groups · ${fmt(totals.messages)} messages`;

  if (q || h || view !== "hier") {
    let list = all;
    if (h) list = list.filter((g) => hierarchyOf(g.name) === h);
    if (q) {
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      list = list.filter((g) => {
        const n = g.name.toLowerCase();
        return words.every((w) => n.includes(w));
      });
    }
    const effSort: SortKey = view === "top" && !sp.sort ? "messages" : sort;
    list = [...list].sort(SORTS[effSort]);
    if (view === "top" && !q && !h) list = list.slice(0, 100);

    const msgs = list.reduce((s, g) => s + g.message_count, 0);
    meta = `${fmt(list.length)} groups · ${fmt(msgs)} messages`;
    if (h) {
      crumbs = (
        <>
          <Sep />
          <span className="here">{h}{h.startsWith("(") ? "" : ".*"}</span>
        </>
      );
    }
    body =
      list.length === 0 ? (
        <div className="p9-empty">
          No groups match “{q}”.{" "}
          <Link href={`/search?q=${encodeURIComponent(q)}`}>Search messages for it instead →</Link>
        </div>
      ) : (
        <GroupTable
          groups={list}
          sort={effSort}
          linkFor={(s) => homeHref({ q, h, view, sort: s })}
        />
      );
  } else {
    const hs = hierarchies(all);
    const max = hs[0]?.messages ?? 1;
    body = (
      <table className="p9-table">
        <thead>
          <tr>
            <th>hierarchy</th>
            <th className="col-count hide-sm">groups</th>
            <th className="col-count">messages</th>
            <th className="col-date">first</th>
            <th className="col-date">last</th>
          </tr>
        </thead>
        <tbody>
          {hs.map((x) => (
            <tr key={x.name}>
              <td className="col-subj">
                <Link href={homeHref({ h: x.name })}>
                  {x.name}
                  {x.name.startsWith("(") ? "" : ".*"}
                </Link>
              </td>
              <td className="col-count hide-sm">{fmt(x.groups)}</td>
              <td className="col-count bar-cell">
                <i
                  className="bar"
                  style={{ width: `${Math.max(1, (100 * Math.log10(x.messages + 1)) / Math.log10(max + 1))}%` }}
                />
                <span>{fmt(x.messages)}</span>
              </td>
              <td className="col-date">{fmtDate(x.first)}</td>
              <td className="col-date">{fmtDate(x.last)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <Window path={h ? `/usr/usenet/${h}` : "/usr/usenet"} meta={meta} crumbs={crumbs}>
      <div className="p9-bar">
        <form className="p9-search" action="/search" method="GET" role="search">
          <label htmlFor="q">search</label>
          <input
            id="q"
            type="search"
            name="q"
            placeholder="words, &quot;phrases&quot;, from:pike, subject:plan9"
            data-search
            autoComplete="off"
          />
          <button type="submit">find</button>
        </form>
      </div>
      <div className="p9-bar">
        <span className="dim">view</span>
        <Link href="/" className={view === "hier" && !q && !h ? "on" : undefined}>
          hierarchies
        </Link>
        <Link href={homeHref({ view: "top" })} className={view === "top" && !q ? "on" : undefined}>
          largest
        </Link>
        <Link href={homeHref({ view: "all" })} className={view === "all" && !q ? "on" : undefined}>
          all groups
        </Link>
        <span className="spacer" />
        <form action="/" method="GET" className="p9-opts">
          {h && <input type="hidden" name="h" value={h} />}
          {view !== "hier" && <input type="hidden" name="view" value={view} />}
          <label>
            filter{" "}
            <input type="text" name="q" defaultValue={q} placeholder="lisp, plan9…" size={16} />
          </label>
          {(q || h) && <Link href={view !== "hier" ? homeHref({ view }) : "/"}>clear</Link>}
        </form>
      </div>
      {body}
    </Window>
  );
}
