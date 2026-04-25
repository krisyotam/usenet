import Link from "next/link";
import { getNewsgroups } from "@/lib/db";

export default function Home() {
  const groups = getNewsgroups();
  const totalMessages = groups.reduce((s, g) => s + g.message_count, 0);

  return (
    <div className="p9-win">
      <div className="p9-win-title">
        <span className="path">/usr/usenet</span>
        <span className="meta">
          {groups.length} groups &middot; {totalMessages.toLocaleString()} messages
        </span>
      </div>
      <div className="p9-bread">
        <Link href="/search">search</Link>
      </div>
      <table className="p9-table">
        <thead>
          <tr>
            <th>newsgroup</th>
            <th className="col-count">messages</th>
            <th className="col-date">first</th>
            <th className="col-date">last</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.name}>
              <td>
                <Link href={`/group/${g.name}`}>{g.name}</Link>
              </td>
              <td className="col-count">{g.message_count.toLocaleString()}</td>
              <td className="col-date">{g.first_date ?? ""}</td>
              <td className="col-date">{g.last_date ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
