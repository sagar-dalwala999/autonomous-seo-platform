import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Fitting a Backpack Properly | Summit Trail Gear",
  /* seeded: duplicate meta description, shared with /blog/choosing-hiking-boots (manifest #5) */
  description:
    "Practical hiking gear advice, care tips, and field-tested recommendations from the Summit Trail Gear editorial team.",
};

export default function BackpackFittingPage() {
  return (
    <article>
      <h1>Fitting a backpack properly</h1>
      <p>
        A well-fitted pack transfers most of its weight to your hips, not your shoulders. If your
        shoulders ache after an hour, the pack is either the wrong torso length or adjusted in the
        wrong order. Fit is a sequence, and the sequence matters.
      </p>
      <h2>Measure your torso first</h2>
      <p>
        Torso length runs from the C7 vertebra — the bump at the base of your neck — to the top of
        your hip bones. It has nothing to do with your height. Two people of identical height can
        need different frame sizes, which is why borrowing a friend&apos;s pack so often goes
        badly.
      </p>
      <h2>Load it, then adjust in order</h2>
      <p>
        Fit an empty pack and you learn nothing. Put 10 kg in it, then: hip belt first, centered on
        the iliac crest and snug. Shoulder straps next, until they wrap without carrying. Load
        lifters at roughly 45 degrees. Sternum strap last, and lightly — it stabilizes, it does not
        support.
      </p>
      <h2>Signs the fit is wrong</h2>
      <p>
        Red hip points mean the belt is too loose and riding on bone. A gap between the strap and
        the top of your shoulder means the torso length is too long. Numb hands mean the sternum
        strap or shoulder straps are too tight. Our{" "}
        <Link href="/products/ridgeline-backpack-45l">Ridgeline 45L</Link> ships in three frame
        sizes precisely because no strap can rescue a wrong-sized frame.
      </p>
    </article>
  );
}
