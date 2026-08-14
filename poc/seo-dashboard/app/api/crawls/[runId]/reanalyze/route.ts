import { NextResponse } from "next/server";
import { reanalyzeCrawl, CancelError } from "@/lib/crawl-control";
import { isSafeId, badRequest } from "@/lib/api-shared";
import { requireApiSession } from "@/lib/auth-guard";

/** POST /crawls/:id/reanalyze — re-runs the rules engine over stored data, no re-crawl (spec §7).
 *  Spawns the same analysis CLI crawl-runner.ts's post-crawl hook uses. Real: overwrites
 *  storage/runs/:id/issues.json in place once the child process finishes (async, not awaited). */
export async function POST(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const { runId } = await params;
  if (!isSafeId(runId)) return badRequest("Invalid runId.");
  try {
    await reanalyzeCrawl(runId);
    return NextResponse.json({ analysisId: runId, status: "started" }, { status: 202 });
  } catch (err) {
    if (err instanceof CancelError) return NextResponse.json({ error: { code: "NOT_FOUND", message: err.message } }, { status: err.status });
    console.error("[api/crawls/:id/reanalyze] unexpected error", err);
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "Failed to start reanalysis." } }, { status: 500 });
  }
}
