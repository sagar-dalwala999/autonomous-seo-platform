import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Dashboard | Summit Trail Gear Members",
  description: "Member dashboard summarizing recent orders, saved gear, and quarterly reports.",
};

export default function MembersDashboardPage() {
  return (
    <article>
      <h1>Dashboard</h1>
      <p>
        This dashboard is the landing page members see right after logging in. It pulls together
        the pieces people ask about most: what shipped recently, what is saved for later, and
        where the quarterly gear reports live. Everything here only renders once the session
        cookie has been validated, so a page fetched without it never reaches this markup at all.
      </p>
      <p>
        Two recent orders are on file: a Ridgeline 45L backpack delivered last month, and a
        Cascade rain shell currently in transit. Saved-for-later includes the Switchback trekking
        poles. For a deeper breakdown of usage and spend, the quarterly reports below cover the
        first two quarters of the year in more detail than the order history does.
      </p>
      <ul className="article-list">
        <li>
          <Link href="/members/account">Account settings</Link>
        </li>
        <li>
          <Link href="/members/reports/q1">Q1 report</Link>
        </li>
        <li>
          <Link href="/members/reports/q2">Q2 report</Link>
        </li>
      </ul>
      <h2>Account actions</h2>
      <ul className="article-list">
        <li>
          <a href="/api/session?action=logout">Log out</a>
        </li>
        <li>
          <a href="/logout">Log out</a>
        </li>
        <li>
          <a href="/members/reports/q1/delete">Delete Q1 report</a>
        </li>
      </ul>
    </article>
  );
}
