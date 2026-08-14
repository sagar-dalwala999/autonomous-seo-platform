import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Q2 Report | Summit Trail Gear Members",
  description: "Second-quarter order and usage summary for the logged-in member.",
};

export default function MembersReportsQ2Page() {
  return (
    <article>
      <h1>Q2 report</h1>
      <p>
        One order placed and delivered: the Switchback trekking poles. Total spend for the
        quarter: $89. Newsletter open rate for this member: 3 of 6 emails.
      </p>
      <p>
        <Link href="/members/reports/q1">See the Q1 report</Link> for the first quarter, or{" "}
        <Link href="/members/dashboard">back to the dashboard</Link>.
      </p>
    </article>
  );
}
