import { NextResponse } from "next/server";
import { getRun } from "@/lib/data";
import { readAnalysisReport } from "@/lib/data-issues";
import { isSafeId, badRequest, notFound } from "@/lib/api-shared";
import { requireApiSession } from "@/lib/auth-guard";

/** GET /crawls/:id/summary — headline: score, severity counts, coverage, timings (spec §7). */
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const { runId } = await params;
  if (!isSafeId(runId)) return badRequest("Invalid runId.");

  const [{ report }, analysis] = await Promise.all([getRun(runId), readAnalysisReport(runId)]);
  if (!report) return notFound(`No completed run found for "${runId}".`);

  return NextResponse.json({
    runId,
    startUrl: report.startUrl,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    durationMs: report.durationMs,
    coveragePercent: report.coveragePercent,
    pagesCrawled: report.successful,
    pagesFailed: report.failed,
    healthScore: analysis?.healthScore ?? null,
    severityCounts: analysis?.counts ?? null,
    rulesRun: analysis?.rulesRun ?? null,
    analysisAvailable: analysis !== null,
  });
}
