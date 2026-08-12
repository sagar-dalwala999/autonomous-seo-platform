import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  /* seeded: duplicate title, shared with /blog/layering-basics (manifest #2) */
  title: "Hiking Gear Tips | Summit Trail Gear",
  description:
    "How to wash, dry, and re-waterproof rain shells so the membrane keeps breathing and water keeps beading.",
  /* seeded: canonical points at an unrelated product URL (manifest #15a) */
  alternates: {
    canonical: "https://summittrailgear.example/products/cascade-rain-shell",
  },
};

export default function RainGearCarePage() {
  return (
    <article>
      <h1>Caring for rain gear</h1>
      <p>
        Rain shells rarely wear out — they get dirty. Body oils and trail grime clog the membrane
        and kill the water-repellent finish, and the jacket &quot;wets out&quot; long before the
        fabric actually fails. Twenty minutes of care restores most of them.
      </p>
      <h2>Wash more, not less</h2>
      <p>
        The counterintuitive rule: a dirty shell breathes worse than a frequently washed one. Use a
        technical cleaner, not household detergent, close every zipper, and skip fabric softener
        forever. Two washes a season is a sensible floor for a jacket in regular use.
      </p>
      <h2>Heat revives DWR</h2>
      <p>
        After washing, tumble dry on low or iron on low through a tea towel. Heat re-activates the
        durable water-repellent coating. When water stops beading even after heat, apply a spray-on
        DWR — that is a ten-minute job, not a reason to replace a jacket.
      </p>
      <h2>Store it dry and loose</h2>
      <p>
        Never store a shell compressed or damp. Hang it in a closet and it will outlast the tent.
        This routine is exactly what we run on our own{" "}
        <Link href="/products/cascade-rain-shell">Cascade shell</Link>, and it pairs with the
        system in the <Link href="/blog/layering-basics">layering primer</Link>.
      </p>
    </article>
  );
}
