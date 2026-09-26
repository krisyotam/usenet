import { Window, Sep } from "@/components/Window";

export default function Loading() {
  return (
    <Window path="/usr/usenet/search" meta="searching…" crumbs={<><Sep /><span className="here">search</span></>}>
      <div className="p9-empty">Searching the archive…</div>
    </Window>
  );
}
