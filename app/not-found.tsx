import Link from "next/link";
import { Window, Sep } from "@/components/Window";

export default function NotFound() {
  return (
    <Window path="/usr/usenet/404" crumbs={<><Sep /><span className="here">not found</span></>}>
      <div className="p9-empty">
        No such group or message. Try the <Link href="/">group list</Link> or{" "}
        <Link href="/search">search</Link>.
      </div>
    </Window>
  );
}
