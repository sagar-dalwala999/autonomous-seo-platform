import { NextRequest, NextResponse } from "next/server";
import { readAnalysisReport } from "@/lib/data-issues";
import { isSafeId, badRequest, notFound, parseOffsetPaging, paginate } from "@/lib/api-shared";
import { requireApiSession } from "@/lib/auth-guard";

/** GET /crawls/:id/issues/:ruleId — one rule, every affected page (spec §7). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string; ruleId: string }> }) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const { runId, ruleId } = await params;
  if (!isSafeId(runId)) return badRequest("Invalid runId.");

  const report = await readAnalysisReport(runId);
  if (!report) return notFound(`No analysis found for run "${runId}".`);

  const findings = report.issues.filter((i) => i.ruleId === ruleId);
  if (findings.length === 0) return notFound(`No findings for rule "${ruleId}" in run "${runId}".`);

  const { page, pageSize } = parseOffsetPaging(request.nextUrl.searchParams);
  const { data, page: pageMeta } = paginate(findings, page, pageSize);
  return NextResponse.json({
    rule: { ruleId, category: findings[0].category, severity: findings[0].severity, howToFix: findings[0].howToFix },
    findings: data,
    page: pageMeta,
  });
}
