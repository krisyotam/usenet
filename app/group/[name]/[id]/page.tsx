import Link from "next/link";
import { notFound } from "next/navigation";
import { getMessage, getAdjacentIds } from "@/lib/db";

function formatBody(body: string): React.ReactNode[] {
  const lines = body.split("\n");
  return lines.map((line, i) => {
    if (line.startsWith(">>")) {
      return (
        <span key={i}>
          <span className="q2">{line}</span>
          {"\n"}
        </span>
      );
    }
    if (line.startsWith(">")) {
      return (
        <span key={i}>
          <span className="q1">{line}</span>
          {"\n"}
        </span>
      );
    }
    return <span key={i}>{line}{"\n"}</span>;
  });
}

export default async function MessagePage({
  params,
}: {
  params: Promise<{ name: string; id: string }>;
}) {
  const { name, id: idStr } = await params;
  const originalId = parseInt(idStr);
  if (isNaN(originalId)) notFound();

  const message = getMessage(name, originalId);
  if (!message) notFound();

  const { prev, next } = getAdjacentIds(name, originalId);

  return (
    <div className="p9-win">
      <div className="p9-win-title">
        <span className="path">
          /usr/usenet/{name}/{originalId}
        </span>
      </div>
      <div className="p9-bread">
        <Link href="/">usenet</Link> / <Link href={`/group/${name}`}>{name}</Link> / {originalId}
      </div>
      <div className="p9-tagbar">
        <div className="hdr">
          <span className="hdr-label">From:</span>
          <span>{message.from_addr || "(unknown)"}</span>
        </div>
        <div className="hdr">
          <span className="hdr-label">Date:</span>
          <span>{message.date || "(unknown)"}</span>
        </div>
        <div className="hdr">
          <span className="hdr-label">Subject:</span>
          <span>{message.subject || "(no subject)"}</span>
        </div>
        {message.message_id && (
          <div className="hdr">
            <span className="hdr-label">Message-ID:</span>
            <span>{message.message_id}</span>
          </div>
        )}
      </div>
      <pre className="p9-msg-body">{formatBody(message.body)}</pre>
      <div className="p9-msg-nav">
        {prev !== null ? (
          <Link href={`/group/${name}/${prev}`}>&#9666; prev</Link>
        ) : (
          <span style={{ color: "#999" }}>&#9666; prev</span>
        )}
        <Link href={`/group/${name}`}>index</Link>
        {next !== null ? (
          <Link href={`/group/${name}/${next}`} className="right">
            next &#9656;
          </Link>
        ) : (
          <span className="right" style={{ color: "#999" }}>
            next &#9656;
          </span>
        )}
      </div>
    </div>
  );
}
