import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How to Choose Hiking Boots | Summit Trail Gear",
  /* seeded: duplicate meta description, shared with /blog/backpack-fitting (manifest #5) */
  description:
    "Practical hiking gear advice, care tips, and field-tested recommendations from the Summit Trail Gear editorial team.",
};

export default function ChoosingHikingBootsPage() {
  return (
    <article>
      {/* seeded: invalid JSON-LD — truncated, unparseable (manifest #11a) */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html:
            '{"@context":"https://schema.org","@type":"Article","headline":"How to Choose Hiking Boots","author":{"@type":"Organization","name":"Summit Trail Gear",',
        }}
      />
      <h1>How to choose hiking boots</h1>
      <p>
        Boot choice comes down to three questions: how much weight will you carry, what surface
        will you walk on, and how much support do your ankles actually need? Most day hikers on
        maintained trails are better served by a light, flexible shoe than the stiff leather boots
        their parents wore.
      </p>
      <h2>Fit before features</h2>
      <p>
        Shop in the afternoon when your feet are slightly swollen, wear the socks you hike in, and
        insist on a thumb&apos;s width of space in front of your longest toe. A boot that is
        perfect in the store but tight on a descent will cost you toenails. Heel lift of more than
        a few millimeters means blisters — try a different last, not a thicker sock.
      </p>
      <h2>Match stiffness to load</h2>
      <p>
        Carrying under 10 kg on groomed trail? Trail runners or light hikers. Carrying a full
        multi-day load, or moving over talus and scree? A stiffer midsole pays for its weight. Our{" "}
        <Link href="/products/granite-hiking-boots">Granite boots</Link> sit in the middle of that
        range on purpose.
      </p>
      <h2>Break them in anyway</h2>
      <p>
        Modern boots need less break-in than old full-grain leather, but never take a new pair on a
        long trip untested. Two or three short local walks reveal hot spots while the fix is still
        cheap. Pair new boots with the advice in our{" "}
        <Link href="/blog/trail-nutrition">trail nutrition article</Link> and your feet and legs
        will both finish the day working.
      </p>
    </article>
  );
}
