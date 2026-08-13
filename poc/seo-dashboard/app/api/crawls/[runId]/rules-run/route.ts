import { NextResponse } from "next/server";
import { readAnalysisReport } from "@/lib/data-issues";
import { isSafeId, badRequest, notFound } from "@/lib/api-shared";
import { requireApiSession } from "@/lib/auth-guard";

/** GET /crawls/:id/rules-run — the honesty manifest (spec §5, §7): rulesRun / rulesSkipped /
 *  rulesErrored. rulesSkippedDetail/rulesErroredDetail now ship on AnalysisReport
 *  (src/analysis/priority/priority.ts's buildRuleStatusDetail) with the {ruleId, category, scope,
 *  pageCount, missing[]} / {..., message, pageCount} shapes — read as-is. `available: false` only
 *  for runs whose issues.json predates that slice (fields absent, never fabricated as []). */
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const { runId } = await params;
  if (!isSafeId(runId)) return badRequest("Invalid runId.");

  const report = await readAnalysisReport(runId);
  if (!report) return notFound(`No analysis found for run "${runId}".`);

  const skippedShapeAvailable = report.rulesSkippedDetail !== undefined;
  const erroredAvailable = report.rulesErroredDetail !== undefined;

  return NextResponse.json({
    rulesRun: report.rulesRun,
    skipped: skippedShapeAvailable
      ? report.rulesSkippedDetail
      : report.rulesSkippedDataUnavailable.map((ruleId) => ({ ruleId, pageCount: null, missing: [] as string[] })),
    skippedShapeAvailable,
    errored: erroredAvailable ? report.rulesErroredDetail : ([] as unknown[]),
    erroredAvailable,
  });
}
