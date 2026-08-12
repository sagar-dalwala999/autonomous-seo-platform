import type { Metadata } from "next";

/* seeded: thin content — main content under 80 words (manifest #17) */
export const metadata: Metadata = {
  title: "Trail Snacks We Pack | Summit Trail Gear",
  description: "A short list of the trail snacks the Summit Trail Gear team actually packs.",
};

export default function TrailSnacksPage() {
  return (
    <article>
      <h1>Trail snacks we pack</h1>
      <p>
        Salted cashews, dried mango, and dark chocolate cover most day hikes. On longer trips we
        add hard cheese and tortillas.
      </p>
      <p>Buy nuts in bulk and repackage them — boxes and jars stay home.</p>
    </article>
  );
}
