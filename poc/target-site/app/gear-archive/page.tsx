import type { Metadata } from "next";

/* seeded: orphan page — no other page links here, absent from sitemap.xml (manifest #8) */
export const metadata: Metadata = {
  title: "Gear Archive | Summit Trail Gear",
  description:
    "Retired Summit Trail Gear products: what we made, what we learned, and why each item left the line.",
};

export default function GearArchivePage() {
  return (
    <article>
      <h1>Gear archive</h1>
      <p>
        Products leave the line for a reason, and the reasons are worth keeping. This archive
        records what each retired item taught us.
      </p>
      <h2>Foothill 30L daypack (2019–2021)</h2>
      <p>
        Our first pack. The roll-top looked clever in photos and annoyed everyone on trail —
        access matters more than silhouette. Its hip-belt pocket pattern survives on the Ridgeline.
      </p>
      <h2>Ember alcohol stove (2020–2022)</h2>
      <p>
        Light, silent, and lovely — retired when fire restrictions made alcohol stoves unusable
        for half the season in the ranges we serve. The wide-burner idea reappeared in the Summit
        stove.
      </p>
      <h2>Sawtooth gaiters (2021–2023)</h2>
      <p>
        Good gaiters, wrong company. Sewing them stole bench time from packs, and better gaiters
        already existed at the price. Knowing what not to make is also product development.
      </p>
    </article>
  );
}
