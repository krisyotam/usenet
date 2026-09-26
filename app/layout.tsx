import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const plex = IBM_Plex_Mono({
  weight: ["400", "500", "700"],
  style: ["normal", "italic"],
  subsets: ["latin", "latin-ext"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Usenet Archives", template: "%s · Usenet Archives" },
  description: "Usenet newsgroup archive viewer, 1980–2014, with full-text search.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#B5B5AD",
};

/*
 * Keyboard: j/→ next · k/← prev · u up · / search.
 * Acts on links marked rel=next / rel=prev / rel=up, so every page opts in
 * just by marking its links. Ignored while typing or with modifiers held.
 */
const keys = `
document.addEventListener("keydown", function (e) {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
  var t = e.target, tag = t && t.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) {
    if (e.key === "Escape") t.blur();
    return;
  }
  function go(rel) {
    var a = document.querySelector('a[rel~="' + rel + '"]');
    if (a) { e.preventDefault(); a.click(); }
  }
  switch (e.key) {
    case "j": case "ArrowRight": go("next"); break;
    case "k": case "ArrowLeft": go("prev"); break;
    case "u": go("up"); break;
    case "/":
      var q = document.querySelector("input[data-search]");
      e.preventDefault();
      if (q) { q.focus(); q.select(); } else { location.href = "/search"; }
      break;
  }
});`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={plex.variable}>
      <body>
        {children}
        <footer className="p9-foot">
          <kbd>j</kbd>/<kbd>k</kbd> next/prev · <kbd>u</kbd> up · <kbd>/</kbd> search
        </footer>
        <script dangerouslySetInnerHTML={{ __html: keys }} />
      </body>
    </html>
  );
}
