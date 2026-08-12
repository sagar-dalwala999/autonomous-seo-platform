import type { Metadata } from "next";

/* seeded: weakly-linked page — its ONLY inlink is from /guides/first-time-backpacking (manifest #9) */
export const metadata: Metadata = {
  title: "Summit Stove | Summit Trail Gear",
  description:
    "A 78-gram canister stove with a wide burner head, sold quietly to people who ask about it.",
};

export default function SummitStovePage() {
  return (
    <article>
      <h1>Summit stove</h1>
      <img src="/images/stove-summit.png" alt="Summit canister stove on a flat rock" width={240} height={240} />
      <p>
        The stove we never planned to sell. We machined a handful for our own trips — 78 grams, a
        wider burner head than the ultralight norm, and a valve with enough travel to actually
        simmer — and enough readers asked that it became a quiet product.
      </p>
      <h2>What it is not</h2>
      <p>
        It is not the lightest stove you can buy, and it does not integrate with a proprietary pot.
        It screws onto any standard canister, spreads flame wide enough that real cooking is
        possible, and survives being dropped on granite.
      </p>
      <p>
        Production runs are small. If the buy button is off, the next batch is on the bench —
        check back in a few weeks.
      </p>
    </article>
  );
}
