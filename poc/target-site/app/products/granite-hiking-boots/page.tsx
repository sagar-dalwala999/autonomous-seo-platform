import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Granite Hiking Boots | Summit Trail Gear",
  /* seeded: no meta description on this page (manifest #4) */
};

export default function GraniteHikingBootsPage() {
  return (
    <article>
      <h1>Granite hiking boots</h1>
      <p>
        The Granite sits deliberately in the middle of the stiffness range: supportive enough for a
        loaded multi-day pack, flexible enough that a day hike does not feel like walking in ski
        boots. Nubuck upper, a real rubber rand, and a resole-friendly construction.
      </p>
      <h2>Fit notes</h2>
      <p>
        The last runs slightly wide in the toe box and true to length. Order your street-shoe size,
        then confirm against the method in the{" "}
        <Link href="/blog/choosing-hiking-boots">boot-choosing article</Link> — afternoon feet,
        hiking socks, thumb of space in front of the longest toe.
      </p>
      <h2>Where we test them</h2>
      <p>
        Every revision walks the Granite Ridge loop before it ships — granite slab, talus, and two
        creek crossings in eleven kilometers.
      </p>
      {/* seeded: BMP image — suboptimal format for the web (manifest #10d) */}
      <img src="/images/trail-map.bmp" alt="Trail map of the Granite Ridge test loop" width={400} height={300} />
    </article>
  );
}
