import Link from "next/link";
import type { ReactNode } from "react";

/** A rio-style window: title bar, breadcrumb/tag bar, body. */
export function Window({
  path,
  meta,
  crumbs,
  children,
  wide,
}: {
  path: string;
  meta?: ReactNode;
  crumbs?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <main className={`p9-win${wide ? " wide" : ""}`}>
      <header className="p9-win-title">
        <h1 className="path" title={path}>
          {path}
        </h1>
        {meta && <span className="meta">{meta}</span>}
      </header>
      <nav className="p9-bread" aria-label="Breadcrumb">
        <span className="crumbs">
          <Link href="/">usenet</Link>
          {crumbs}
        </span>
        <span className="nav">
          <Link href="/">groups</Link>
          <Link href="/search">search</Link>
          <Link href="/help">help</Link>
        </span>
      </nav>
      {children}
    </main>
  );
}

export const Sep = () => <span className="sep"> / </span>;
