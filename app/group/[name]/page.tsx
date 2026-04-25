import Link from "next/link";
import { notFound } from "next/navigation";
import { getNewsgroup, getMessages } from "@/lib/db";

export default async function GroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { name } = await params;
  const { page: pageStr } = await searchParams;
  const group = getNewsgroup(name);
  if (!group) notFound();

  const page = Math.max(1, parseInt(pageStr || "1"));
  const perPage = 50;
  const { messages, total } = getMessages(name, page, perPage);
  const totalPages = Math.ceil(total / perPage);

  return (
    <div className="p9-win">
      <div className="p9-win-title">
        <span className="path">/usr/usenet/{name}</span>
        <span className="meta">{total.toLocaleString()} messages</span>
      </div>
      <div className="p9-bread">
        <Link href="/">usenet</Link> / {name} &middot;{" "}
        <Link href={`/search?group=${name}`}>search</Link>
      </div>
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
            <tr key={m.original_id}>
              <td className="col-num">{m.original_id}</td>
              <td>
                <Link href={`/group/${name}/${m.original_id}`}>
                  {m.subject || "(no subject)"}
                </Link>
              </td>
              <td className="col-from">{m.from_addr}</td>
              <td className="col-date">{m.date}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {totalPages > 1 && (
        <div className="p9-pager">
          {page > 1 && (
            <Link href={`/group/${name}?page=${page - 1}`}>&#9666; prev</Link>
          )}
          <span>
            page {page}/{totalPages}
          </span>
          {page < totalPages && (
            <Link href={`/group/${name}?page=${page + 1}`}>next &#9656;</Link>
          )}
        </div>
      )}
    </div>
  );
}
