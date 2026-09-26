import Link from "next/link";
import { fmt } from "@/lib/format";

/** Windowed pager: « ‹ 1 … 4 5 [6] 7 8 … 120 › » plus a jump-to-page box. */
export function Pager({
  page,
  totalPages,
  href,
  action,
  hidden = {},
  label,
}: {
  page: number;
  totalPages: number;
  href: (p: number) => string;
  /** form action for the jump box */
  action: string;
  /** extra params the jump box must carry */
  hidden?: Record<string, string | undefined>;
  label?: string;
}) {
  if (totalPages <= 1) return label ? <div className="p9-pager"><span className="count">{label}</span></div> : null;

  const around = 2;
  const pages: (number | "gap")[] = [];
  const lo = Math.max(1, page - around);
  const hi = Math.min(totalPages, page + around);
  if (lo > 1) pages.push(1);
  if (lo > 2) pages.push("gap");
  for (let p = lo; p <= hi; p++) pages.push(p);
  if (hi < totalPages - 1) pages.push("gap");
  if (hi < totalPages) pages.push(totalPages);

  return (
    <nav className="p9-pager" aria-label="Pagination">
      {page > 1 ? (
        <Link href={href(page - 1)} rel="prev" className="step">
          &#9666; prev
        </Link>
      ) : (
        <span className="step dim">&#9666; prev</span>
      )}
      <span className="pages">
        {pages.map((p, i) =>
          p === "gap" ? (
            <span key={`g${i}`} className="gap">
              …
            </span>
          ) : p === page ? (
            <span key={p} className="cur" aria-current="page">
              {fmt(p)}
            </span>
          ) : (
            <Link key={p} href={href(p)}>
              {fmt(p)}
            </Link>
          )
        )}
      </span>
      {page < totalPages ? (
        <Link href={href(page + 1)} rel="next" className="step">
          next &#9656;
        </Link>
      ) : (
        <span className="step dim">next &#9656;</span>
      )}
      <form action={action} method="GET" className="jump">
        {Object.entries(hidden).map(([k, v]) =>
          v ? <input key={k} type="hidden" name={k} value={v} /> : null
        )}
        <label>
          page{" "}
          <input
            type="number"
            name="page"
            min={1}
            max={totalPages}
            defaultValue={page}
            aria-label="Go to page"
          />{" "}
          / {fmt(totalPages)}
        </label>
      </form>
      {label && <span className="count">{label}</span>}
    </nav>
  );
}
