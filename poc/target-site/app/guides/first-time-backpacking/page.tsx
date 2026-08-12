import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "First-Time Backpacking Guide | Summit Trail Gear",
  description:
    "Plan your first overnight backpacking trip: what to borrow, what to buy, how far to walk, and what to do when it rains.",
};

export default function FirstTimeBackpackingPage() {
  return (
    <article>
      <h1>First-time backpacking</h1>
      <p>
        Your first overnight trip should be slightly boring. Pick a trail you have already day
        hiked, camp five to eight kilometers in, and go with a forecast so good it feels like
        cheating. The goal of trip one is not adventure — it is finding out which of your systems
        fail while failure is still funny.
      </p>
      <h2>Borrow first, buy later</h2>
      <p>
        The fastest way to waste money is to outfit yourself completely before your first night
        out. Borrow or rent the expensive items — tent, sleeping bag, pad — and spend your first
        real money on the two things that must fit your body: footwear and the pack. The{" "}
        <Link href="/blog/choosing-hiking-boots">boot article</Link> and the{" "}
        <Link href="/blog/backpack-fitting">pack-fitting article</Link> will save you both
        purchases&apos; worth of mistakes.
      </p>
      <h2>The gear that matters on night one</h2>
      <p>
        Sleep warmth is the difference between converts and people who never go again. Take a
        warmer bag than the forecast justifies, put a real insulated pad under it, and keep one dry
        set of sleep clothes sacred. For cooking, one pot and a simple canister burner cover
        everything a first trip needs — something small and stable like our{" "}
        <Link href="/products/summit-stove">Summit stove</Link> boils water for dinner and coffee,
        and that is genuinely the whole job description.
      </p>
      <h2>Food and water without spreadsheets</h2>
      <p>
        Dinner, breakfast, and twice the snacks you think are reasonable — the{" "}
        <Link href="/blog/trail-nutrition">trail nutrition article</Link> explains why the extra
        snacks disappear. Carry two liters of water, know where the refill is, and bring a filter
        even for an &quot;there&apos;s a stream&quot; itinerary, because the stream has heard that
        promise before.
      </p>
      <h2>When something goes wrong</h2>
      <p>
        Something small will: a leaking valve, a forgotten spork, rain at dinner. This is the
        curriculum. Walk out if you are cold and wet with hours of daylight left — the trail does
        not award points for suffering, and the car is part of the safety system on trip one.
        Debrief on the drive home: what got used, what stayed buried, what would you not carry
        again. That list is your real gear guide, and it beats every internet checklist including
        ours.
      </p>
    </article>
  );
}
