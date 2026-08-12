import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Switchback Trekking Poles | Summit Trail Gear",
  description:
    "Aluminum three-section trekking poles with cork grips, flick locks, and interchangeable baskets.",
  /* seeded: accidental noindex robots meta (manifest #12) */
  robots: { index: false },
};

export default function SwitchbackTrekkingPolesPage() {
  return (
    <article>
      <h1>Switchback trekking poles</h1>
      {/* seeded: img missing alt attribute (manifest #10a) */}
      <img src="/images/poles-switchback.png" width={240} height={240} />
      <p>
        Aluminum over carbon, on purpose: a bent aluminum pole comes home, a cracked carbon pole
        stays on the mountain. Three sections, external flick locks that work with gloves on, and
        cork grips that mold to your hands over a season.
      </p>
      <h2>Details that matter</h2>
      <p>
        Baskets swap without tools — small for summer, wide for snow. The straps are cut left and
        right, and the lower sections are replaceable, because a pole you can repair is a pole you
        keep.
      </p>
      <p>
        Poles shine brightest on descents with a loaded pack; pair them with the{" "}
        <Link href="/products/ridgeline-backpack-45l">Ridgeline 45L</Link> and your knees will
        notice the difference by the second day.
      </p>
    </article>
  );
}
