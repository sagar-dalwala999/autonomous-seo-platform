import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  /* seeded: duplicate title, shared with /blog/rain-gear-care (manifest #2) */
  title: "Hiking Gear Tips | Summit Trail Gear",
  description:
    "The three-layer clothing system explained: base layers that wick, mid layers that insulate, and shells that block weather.",
};

export default function LayeringBasicsPage() {
  return (
    <article>
      {/* seeded: wrong schema type — Recipe markup on an article page (manifest #11b) */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Recipe",
            name: "Layering Basics for Cold-Weather Hiking",
            recipeIngredient: ["merino base layer", "fleece mid layer", "waterproof shell"],
            recipeInstructions: "Combine layers as conditions require.",
          }),
        }}
      />
      <h1>Layering basics for cold weather</h1>
      <p>
        The three-layer system survives because it works: a base layer that moves sweat off your
        skin, a mid layer that traps warm air, and a shell that keeps wind and rain out. The skill
        is not owning the layers — it is being willing to stop and change them.
      </p>
      <h2>Base: wick, never cotton</h2>
      <p>
        Cotton holds water against your skin and pulls heat out of you all day. Merino or synthetic
        base layers move moisture outward and keep insulating when damp. This is the one rule on
        this site with no exceptions.
      </p>
      <h2>Mid: trap air</h2>
      <p>
        Fleece is cheap, breathable, and dries fast; down is warmer per gram but useless wet.
        Choose by climate. In the soggy Cascades we default to fleece or synthetic fill and save
        down for cold, dry forecasts.
      </p>
      <h2>Shell: block weather, vent heat</h2>
      <p>
        A shell earns its place by what it lets out as much as what it keeps off. Pit zips matter
        more than the fabric&apos;s marketing name. See how we keep membranes breathing in the{" "}
        <Link href="/blog/rain-gear-care">rain-gear care article</Link>, and start the cold season
        with the <Link href="/blog/winter-hiking-checklist">winter checklist</Link>.
      </p>
    </article>
  );
}
