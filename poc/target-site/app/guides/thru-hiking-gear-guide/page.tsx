import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  /* seeded: overlong title, well past 70 chars (manifest #3a) */
  title:
    "The Complete Ultimate Thru-Hiking Gear Checklist and Buying Guide for Long-Distance Backpacking Trips | Summit Trail Gear",
  description:
    "A category-by-category thru-hiking gear guide: shelter, sleep, pack, clothing, kitchen, water, electronics, and repair.",
};

export default function ThruHikingGearGuidePage() {
  return (
    <article>
      <h1>The thru-hiking gear guide</h1>
      {/* seeded: very large unoptimized image, multi-MB PNG (manifest #10b) */}
      <img
        src="/images/hero-large.png"
        alt="A fully loaded thru-hiking pack leaning against a trail marker"
        width={1200}
        height={1200}
      />
      <p>
        A thru-hike is a supply-chain problem you carry on your back. Over four to six months,
        every gram is lifted roughly a hundred thousand times, every item is used daily or resented
        daily, and there is no closet to send mistakes home to — only a post office and a receipt.
        This guide walks every major category in the order we would buy them, cheapest-to-replace
        last.
      </p>
      <h2>The big three: shelter, sleep, pack</h2>
      <p>
        Shelter, sleep system, and pack are where weight lives and where money buys the most
        comfort. A realistic target for the three together is four to five kilograms without
        spending into ultralight cottage-industry territory. Choose the shelter first: a
        double-wall tent forgives condensation and bad campsites, a tarp rewards skill with
        hundreds of saved grams. Quilts beat mummy bags for most sleepers once temperatures stay
        above freezing, and a pad&apos;s R-value matters more than its thickness.
      </p>
      <p>
        Buy the pack last, after everything else is owned and weighed. A load under twelve
        kilograms rides happily in a frameless or lightly framed pack like our{" "}
        <Link href="/products/ridgeline-backpack-45l">Ridgeline 45L</Link>; heavier loads deserve
        real frames and real hip belts. The{" "}
        <Link href="/blog/backpack-fitting">fitting article</Link> applies doubly on a thru-hike —
        a hot spot that is an annoyance on a weekend is an exit wound by week three.
      </p>
      <h2>Clothing: the worn and the carried</h2>
      <p>
        Thru-hikers own two outfits: the one being worn and the one being saved. The worn kit is a
        sun hoody, shorts or trail pants, and shoes you have already proven —
        see <Link href="/blog/choosing-hiking-boots">choosing hiking boots</Link> for the fit
        method. The carried kit is insulation and rain: a fleece or light puffy, a shell you
        maintain per the <Link href="/blog/rain-gear-care">care article</Link>, sleep socks that
        never touch trail, and a warm hat. Everything else is town clothes, and town clothes are a
        luxury tax.
      </p>
      <h2>Kitchen and water</h2>
      <p>
        The cold-soak versus stove debate is a personality test, not an engineering question. A
        canister stove, one 750 ml pot, and a long spoon cover the cooking case. Water treatment on
        most long trails is a squeeze filter backflushed nightly, with chemical drops as backup
        when the filter clogs or freezes. Carry capacity is route-dependent: two liters is plenty
        where water is everywhere; desert sections demand six and punish optimism.
      </p>
      <h2>Electronics and repair</h2>
      <p>
        A phone, a ten-thousand mAh battery, a headlamp, and the shortest cables that reach. The
        repair kit that earns its weight: needle and thread, tenacious tape, a cordage hank, spare
        buckle, and a pad-patch kit. Every specialized tool beyond that gets mailed home from the
        first town with a post office.
      </p>
      <h2>The final audit</h2>
      <p>
        Before the start date, lay everything out and demand each item answer one question: what
        trip-ending problem do you solve? Duplicates fail the audit, &quot;just in case&quot; fails
        the audit, camp chairs pass only for the honest. Then stop optimizing and go walk — the
        lightest thing you can leave behind is the second-guessing.
      </p>
    </article>
  );
}
