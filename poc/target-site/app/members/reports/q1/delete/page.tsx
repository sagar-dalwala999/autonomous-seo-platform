import { recordDangerHit } from "@/lib/danger-hits";

// force-dynamic: the hit counter is a side effect that must fire per real request, never once at build time
export const dynamic = "force-dynamic";

export default function MembersReportsQ1DeletePage() {
  recordDangerHit();
  return (
    <article>
      <h1>DELETED</h1>
      <p>
        The Q1 report has been deleted. This is a safety-test page: fetching it only increments an
        in-memory counter exposed at <code>/api/danger-hits</code> — nothing is actually removed,
        and no filesystem write occurs.
      </p>
    </article>
  );
}
