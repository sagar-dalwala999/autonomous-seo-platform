import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Cascade Rain Shell | Summit Trail Gear",
  description:
    "A three-layer waterproof shell built for the Pacific Northwest: pit zips, a real hood, and a cut that fits over insulation.",
};

export default function CascadeRainShellPage() {
  return (
    <article>
      <h1>Cascade rain shell</h1>
      {/* seeded: img missing alt attribute (manifest #10a) */}
      <img src="/images/shell-cascade.png" width={240} height={240} />
      <p>
        Built for the climate we live in: a three-layer waterproof shell with long pit zips, a hood
        that turns with your head and fits over a hat, and a cut sized to layer over fleece without
        ballooning in the wind.
      </p>
      {/* seeded: second H1 on the page (manifest #6b) */}
      <h1>Built for wet-side weather</h1>
      <p>
        We skipped the features that fail first: no laminated visor to peel, no water-resistant
        zippers where a storm flap is more durable, no liner to soak. Seams are taped, cuffs close
        flat under gloves, and the hem cinches one-handed.
      </p>
      <p>
        Shells last as long as their care routine — the{" "}
        <Link href="/blog/rain-gear-care">rain-gear care article</Link> covers the wash-and-reproof
        cycle that keeps the membrane breathing.
      </p>
    </article>
  );
}
