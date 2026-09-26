"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="p9-win">
      <header className="p9-win-title">
        <h1 className="path">/usr/usenet/error</h1>
      </header>
      <div className="p9-error">Something broke rendering this page{error.digest ? ` (${error.digest})` : ""}.</div>
      <div className="p9-msg-nav">
        <button type="button" onClick={() => unstable_retry()}>retry</button>
        <Link href="/">groups</Link>
        <Link href="/search">search</Link>
      </div>
    </main>
  );
}
