import Link from "next/link";
import { searchMessages } from "@/lib/db";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; group?: string; page?: string }>;
}) {
  const { q, group, page: pageStr } = await searchParams;
  const page = Math.max(1, parseInt(pageStr || "1"));
  const perPage = 50;

  if (!q) {
    return (
      <div className="p9-win">
        <div className="p9-win-title">
          <span className="path">/usr/usenet/search</span>
        </div>
        <div className="p9-bread">
          <Link href="/">usenet</Link> / search
        </div>
        <form className="p9-search" action="/search" method="GET">
          <span>Search:</span>
          <input type="text" name="q" autoFocus />
          <button type="submit">find</button>
        </form>
        <div className="p9-empty">Enter a search query above.</div>
      </div>
    );
  }

  const { messages, total } = searchMessages(q, group, page, perPage);
  const totalPages = Math.ceil(total / perPage);

  return (
    <div className="p9-win">
      <div className="p9-win-title">
        <span className="path">/usr/usenet/search</span>
        <span className="meta">{total.toLocaleString()} results</span>
      </div>
      <div className="p9-bread">
        <Link href="/">usenet</Link> / search
        {group && (
          <>
            {" "}/ <Link href={`/group/${group}`}>{group}</Link>
          </>
        )}
      </div>
      <form className="p9-search" action="/search" method="GET">
        <span>Search:</span>
        <input type="text" name="q" defaultValue={q} />
        {group && <input type="hidden" name="group" value={group} />}
        <button type="submit">find</button>
      </form>
      {messages.length === 0 ? (
        <div className="p9-empty">No results for &quot;{q}&quot;.</div>
      ) : (
        <table className="p9-table">
          <thead>
            <tr>
              <th>group</th>
              <th className="col-num">#</th>
              <th>subject</th>
              <th className="col-from">from</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((m) => (
              <tr key={m.id}>
                <td>
                  <Link href={`/group/${m.newsgroup}`}>{m.newsgroup}</Link>
                </td>
                <td className="col-num">{m.original_id}</td>
                <td>
                  <Link href={`/group/${m.newsgroup}/${m.original_id}`}>
                    {m.subject || "(no subject)"}
                  </Link>
                </td>
                <td className="col-from">{m.from_addr}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {totalPages > 1 && (
        <div className="p9-pager">
          {page > 1 && (
            <Link
              href={`/search?q=${encodeURIComponent(q)}${group ? `&group=${group}` : ""}&page=${page - 1}`}
            >
              &#9666; prev
            </Link>
          )}
          <span>
            page {page}/{totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={`/search?q=${encodeURIComponent(q)}${group ? `&group=${group}` : ""}&page=${page + 1}`}
            >
              next &#9656;
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
