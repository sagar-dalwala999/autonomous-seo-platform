import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Summit Trail Gear | Outdoor Equipment & Hiking Advice",
  description:
    "Summit Trail Gear reviews hiking equipment, publishes trail-tested buying guides, and sells a small line of packs, shells, and boots.",
};

export default function HomePage() {
  return (
    <article>
      <h1>Gear that earns its place in your pack</h1>
      {/* seeded: img without width/height attributes (manifest #10c) */}
      <img src="/images/hero-home.png" alt="Hikers crossing a ridgeline at sunrise" />
      <p>
        Summit Trail Gear started as a spreadsheet two friends kept while section-hiking the
        Cascades: what worked, what broke, and what never left the trunk of the car. Today we
        publish field-tested advice and sell a short list of equipment we actually carry.
      </p>
      <p>
        New to the site? Start with our <Link href="/guides">long-form guides</Link>, browse the{" "}
        <Link href="/blog">blog</Link> for quick answers, or head straight to the{" "}
        <Link href="/products">product line</Link>. You can read more about the team on the{" "}
        <Link href="/about">about page</Link>.
      </p>
      <h2>This season</h2>
      <p>
        Shoulder-season hiking rewards preparation. Our{" "}
        <Link href="/blog/layering-basics">layering primer</Link> covers the three-layer system,
        and the <Link href="/blog/winter-hiking-checklist">winter checklist</Link> keeps cold-day
        packing honest. If your boots are due for replacement, the{" "}
        <Link href="/blog/choosing-hiking-boots">boot-fitting article</Link> is the place to begin.
      </p>
      <p>
        {/* seeded: broken internal link, /gear-sale does not exist (manifest #7) */}
        Clearance stock moves fast — check the <Link href="/gear-sale">end-of-season gear sale</Link>{" "}
        before it is gone.
      </p>
      <p>
        {/* seeded: absolute www URL while other pages use non-www (manifest #15c) */}
        Planning a first overnight trip? The full guide library lives at{" "}
        <a href="https://www.summittrailgear.example/guides">www.summittrailgear.example/guides</a>.
      </p>
    </article>
  );
}
