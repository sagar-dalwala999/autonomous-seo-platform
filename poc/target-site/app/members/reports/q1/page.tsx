import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Q1 Report | Summit Trail Gear Members",
  description: "First-quarter order and usage summary for the logged-in member.",
};

export default function MembersReportsQ1Page() {
  return (
    <article>
      <h1>Q1 report</h1>
      <p>
        Two orders placed, one delivered, one currently in transit. Total spend for the quarter:
        $412. Most-viewed product page: the Ridgeline 45L backpack.
      </p>
      <p>
        <Link href="/members/reports/q2">See the Q2 report</Link> for the second quarter, or{" "}
        <Link href="/members/dashboard">back to the dashboard</Link>.
      </p>
    </article>
  );
}
