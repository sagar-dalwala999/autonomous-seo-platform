import { NextResponse } from "next/server";
import { analyzeRunFull, CancelError } from "@/lib/crawl-control";
import { isSafeId, badRequest } from "@/lib/api-shared";
import { requireApiSession } from "@/lib/auth-guard";

/** POST /crawls/:id/reanalyze — the in-app "Analyze now": re-runs the rules engine AND the
 *  automation classifier AND the fix-plan generator over stored data, no re-crawl (spec §7 +
 *  FR-3.7/FR-3.8 outputs). Awaits each step, so when this resolves the run has issues.json,
 *  automation-report.json, and fix-plan.json — the "Not classified"/"fix plan not generated"
 *  states are gone until a fresh chain genuinely produces those files. The client posts, then
 *  router.refresh()s to pick up the new artifacts. */
export async function POST(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const { runId } = await params;
  if (!isSafeId(runId)) return badRequest("Invalid runId.");
  try {
    const { artifacts } = await analyzeRunFull(runId);
    return NextResponse.json({ analysisId: runId, status: "done", artifacts });
  } catch (err) {
    if (err instanceof CancelError) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: err.message } }, { status: err.status });
    }
    console.error("[api/crawls/:id/reanalyze] unexpected error", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err instanceof Error ? err.message : "Failed to analyze run." } },
      { status: 500 },
    );
  }
}
