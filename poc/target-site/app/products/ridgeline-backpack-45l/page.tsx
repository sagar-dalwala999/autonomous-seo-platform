import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Ridgeline 45L Backpack | Summit Trail Gear",
  description:
    "The Ridgeline 45L is our do-everything multi-day pack: 1.4 kg, three frame sizes, and a hip belt that carries the load.",
};

export default function RidgelineBackpackPage() {
  return (
    <article>
      {/* seeded: valid Product JSON-LD but missing offers/price/availability (manifest #11c) */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Product",
            name: "Ridgeline 45L Backpack",
            image: "https://summittrailgear.example/images/pack-ridgeline.png",
            description:
              "A 1.4 kg multi-day backpack with three frame sizes and a load-bearing hip belt.",
            brand: { "@type": "Brand", name: "Summit Trail Gear" },
          }),
        }}
      />
      <h1>Ridgeline 45L backpack</h1>
      {/* seeded: img missing alt attribute (manifest #10a) */}
      <img src="/images/pack-ridgeline.png" width={240} height={240} />
      <p>
        The Ridgeline is the pack that started the company: 45 liters, 1.4 kg, and a frame that
        moves weight to your hips where it belongs. It carries a week of summer food or a winter
        day load with equal composure.
      </p>
      <h2>Why it works</h2>
      <p>
        Three real frame sizes instead of one &quot;adjustable&quot; compromise, a wraparound hip
        belt with usable pockets, and a single cavernous main compartment with a floating lid. No
        trampoline back panel, no fifteen straps you never touch.
      </p>
      <p>
        Get the size right before ordering — the{" "}
        <Link href="/blog/backpack-fitting">backpack fitting article</Link> shows how to measure
        your torso in two minutes.
      </p>
    </article>
  );
}
