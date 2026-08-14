import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Members | Summit Trail Gear",
  description: "The Summit Trail Gear members area: dashboard, account, and quarterly reports.",
};

export default function MembersIndexPage() {
  return (
    <article>
      <h1>Members area</h1>
      <p>Welcome back. This area is only reachable with a valid session cookie.</p>
      <ul className="article-list">
        <li>
          <Link href="/members/dashboard">Dashboard</Link>
        </li>
        <li>
          <Link href="/members/account">Account</Link>
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
