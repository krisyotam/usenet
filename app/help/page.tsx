import type { Metadata } from "next";
import Link from "next/link";
import { Window, Sep } from "@/components/Window";
import { searchHref } from "@/lib/format";

export const metadata: Metadata = { title: "help" };

const SYNTAX: [string, string][] = [
  ["unix kernel", "messages containing both words (in the body)"],
  ['"bell labs"', "exact phrase"],
  ["plan9*", "prefix — plan9, plan9port, plan9fans…"],
  ["lisp -scheme", "exclude a word; also -\"phrase\", -from:x"],
  ["acme OR sam", "either term"],
  ["from:pike", "author name or address (also f:, by:)"],
  ['from:"dennis ritchie"', "author, as a phrase"],
  ["subject:minix", "subject line (also s:, title:)"],
  ["group:comp.lang.c", "one newsgroup (also in:, g:)"],
  ["after:1990 before:1992-06", "date bounds: YYYY, YYYY-MM or YYYY-MM-DD"],
];

const KEYS: [string, string][] = [
  ["j  →", "next message / next page"],
  ["k  ←", "previous message / previous page"],
  ["u", "up: message → group index → hierarchy"],
  ["/", "focus the search box"],
  ["Esc", "leave the search box"],
];

export default function Help() {
  return (
    <Window path="/usr/usenet/help" crumbs={<><Sep /><span className="here">help</span></>}>
      <div className="p9-doc">
        <h2>search syntax</h2>
        <table>
          <tbody>
            {SYNTAX.map(([q, d]) => (
              <tr key={q}>
                <td>
                  <Link href={searchHref({ q })}>
                    <code>{q}</code>
                  </Link>
                </td>
                <td>{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          Terms combine: <code>from:ritchie subject:unix after:1985</code>. Words match whole
          tokens, case-insensitively; punctuation splits words, so <code>bell-labs.com</code> is the
          phrase “bell labs com”. Results sort by best match; newest/oldest sorting is available when
          a query matches under 100,000 messages.
        </p>

        <h2>keyboard</h2>
        <table>
          <tbody>
            {KEYS.map(([k, d]) => (
              <tr key={k}>
                <td>
                  <code>{k}</code>
                </td>
                <td>{d}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>reading</h2>
        <p>
          Quoted text is tinted by depth, attribution lines are italic, and signatures (after a{" "}
          <code>-- </code> line) are dimmed. On a message, <b>posts here</b> / <b>everywhere</b> list
          the author&apos;s other posts and <b>thread</b> finds messages with the same subject.
        </p>
      </div>
    </Window>
  );
}
