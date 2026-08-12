import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Guides | Summit Trail Gear",
  description:
    "Long-form planning guides: complete gear lists and decision frameworks for thru-hiking and first backpacking trips.",
};

export default function GuidesIndexPage() {
  return (
    <article>
      <h1>Guides</h1>
      <p>
        The blog answers quick questions; these guides plan whole trips. Each one is long on
        purpose — print it, argue with it, and pack against it.
      </p>
      <ul className="article-list">
        <li>
          <Link href="/guides/thru-hiking-gear-guide">The thru-hiking gear guide</Link> — every
          category, from shelter to repair kit
        </li>
        <li>
          <Link href="/guides/first-time-backpacking">First-time backpacking</Link> — your first
          overnight, without buying the whole shop
        </li>
        <li>
          {/* seeded: broken internal link, product does not exist (manifest #7) */}
          Referenced gear: the <Link href="/products/alpine-tent">Alpine two-person tent</Link>
        </li>
      </ul>
    </article>
  );
}
