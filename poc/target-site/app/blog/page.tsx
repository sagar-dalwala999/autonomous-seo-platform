import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Blog | Summit Trail Gear",
  description:
    "Short, practical articles on hiking gear: boots, packs, layering, rain shells, nutrition, and seasonal checklists.",
};

export default function BlogIndexPage() {
  return (
    <article>
      <h1>The Summit Trail Gear blog</h1>
      <p>
        Quick, practical answers to the gear questions we hear most. For long-form planning
        material, see the guides section instead.
      </p>
      <ul className="article-list">
        <li>
          <Link href="/blog/choosing-hiking-boots">How to choose hiking boots</Link>
        </li>
        <li>
          <Link href="/blog/backpack-fitting">Fitting a backpack properly</Link>
        </li>
        <li>
          <Link href="/blog/layering-basics">Layering basics for cold weather</Link>
        </li>
        <li>
          <Link href="/blog/rain-gear-care">Caring for rain gear</Link>
        </li>
        <li>
          <Link href="/blog/trail-nutrition">Trail nutrition that actually works</Link>
        </li>
        <li>
          <Link href="/blog/winter-hiking-checklist">Winter hiking checklist</Link>
        </li>
        <li>
          <Link href="/blog/winter-day-hike-checklist">Winter day-hike checklist</Link>
        </li>
        <li>
          <Link href="/blog/trail-snacks">Trail snacks we pack</Link>
        </li>
        <li>
          {/* seeded: broken internal link, article does not exist (manifest #7) */}
          <Link href="/blog/ultralight-tents">Ultralight tents compared</Link>
        </li>
      </ul>
      <p>
        {/* seeded: absolute non-www URL while the homepage uses www (manifest #15c) */}
        Curious who writes these? Meet the team at{" "}
        <a href="https://summittrailgear.example/about">summittrailgear.example/about</a>.
      </p>
    </article>
  );
}
