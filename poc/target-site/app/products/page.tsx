import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Products | Summit Trail Gear",
  description:
    "The Summit Trail Gear line: the Ridgeline 45L pack, Cascade rain shell, Granite hiking boots, and Switchback trekking poles.",
};

/* note: /products/summit-stove is deliberately NOT listed here (manifest #9 weak-link setup) */
export default function ProductsIndexPage() {
  return (
    <article>
      <h1>Our gear</h1>
      <p>
        A short line, on purpose. Everything below has survived at least two full seasons of
        testing in the Cascades before earning a listing.
      </p>
      <ul className="article-list">
        <li>
          <Link href="/products/ridgeline-backpack-45l">Ridgeline 45L backpack</Link> — our
          do-everything multi-day pack
        </li>
        <li>
          <Link href="/products/cascade-rain-shell">Cascade rain shell</Link> — a breathable
          three-layer shell for wet climates
        </li>
        <li>
          <Link href="/products/granite-hiking-boots">Granite hiking boots</Link> — mid-stiffness
          boots for loaded hiking
        </li>
        <li>
          <Link href="/products/switchback-trekking-poles">Switchback trekking poles</Link> —
          aluminum poles with cork grips
        </li>
      </ul>
      <p>
        {/* seeded: http:// (non-https) absolute internal link (manifest #15b) */}
        Not sure what you need? The <a href="http://summittrailgear.example/blog">blog</a> answers
        the most common sizing and fit questions.
      </p>
    </article>
  );
}
