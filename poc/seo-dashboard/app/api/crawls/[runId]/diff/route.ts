import { NextRequest, NextResponse } from "next/server";
import { computeDiff } from "@/lib/data-compare";
import { listRuns } from "@/lib/data";
import { isSafeId, badRequest, notFound, parseOffsetPaging, paginate } from "@/lib/api-shared";
import { requireApiSession } from "@/lib/auth-guard";

/** GET /crawls/:id/diff?against=<crawlId>&section= — convenience diff vs the previous run of the
 *  same site, or an explicit ?against (spec §7). Wraps the existing computeDiff (data-compare.ts,
 *  do-not-touch), paginating whichever section is requested since a large run's `changed` array
 *  can be thousands of rows. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const { runId } = await params;
  if (!isSafeId(runId)) return badRequest("Invalid runId.");

  const runs = await listRuns();
  const head = runs.find((r) => r.runId === runId);
  if (!head) return notFound(`No completed run found for "${runId}".`);

  const against = request.nextUrl.searchParams.get("against");
  let baseRunId = against;
  if (!baseRunId) {
    const sameSite = runs.filter((r) => r.startUrl === head.startUrl && r.runId !== runId).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
    baseRunId = sameSite[0]?.runId ?? null;
  }
  if (!baseRunId) return NextResponse.json({ available: false, reason: "No previous run of the same site to diff against." });
  if (!runs.some((r) => r.runId === baseRunId)) return notFound(`Base run "${baseRunId}" not found.`);

  const diff = await computeDiff(baseRunId, runId);
  const section = request.nextUrl.searchParams.get("section") ?? "summary";
  const sp = request.nextUrl.searchParams;

  if (section === "pages") {
    const { page, pageSize } = parseOffsetPaging(sp);
    return NextResponse.json({ baseRunId, headRunId: runId, ...paginate(diff.changed, page, pageSize) });
  }
  if (section === "issues") {
    return NextResponse.json({ baseRunId, headRunId: runId, issues: diff.issues });
  }
  return NextResponse.json({
    baseRunId,
    headRunId: runId,
    generatedAt: diff.generatedAt,
    addedCount: diff.added.length,
    removedCount: diff.removed.length,
    changedCount: diff.changed.length,
    unchangedCount: diff.unchangedCount,
    issuesAvailable: diff.issues !== null,
  });
}
