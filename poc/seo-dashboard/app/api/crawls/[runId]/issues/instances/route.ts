import { NextRequest, NextResponse } from "next/server";
import { readAnalysisReport } from "@/lib/data-issues";
import { isSafeId, badRequest, notFound, parseOffsetPaging, paginate } from "@/lib/api-shared";
import type { Issue, IssueSeverity } from "@/lib/types";
import { requireApiSession } from "@/lib/auth-guard";

/** GET /crawls/:id/issues/instances — flat instance list, export/agent shape (spec §7). Same
 *  filters as GET /issues but no grouping — one row per Issue. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const { runId } = await params;
  if (!isSafeId(runId)) return badRequest("Invalid runId.");

  const report = await readAnalysisReport(runId);
  if (!report) return notFound(`No analysis found for run "${runId}".`);

  const sp = request.nextUrl.searchParams;
  let issues: Issue[] = report.issues;
  const severity = sp.get("severity") as IssueSeverity | null;
  const category = sp.get("category");
  const ruleId = sp.get("ruleId");
  if (severity) issues = issues.filter((i) => i.severity === severity);
  if (category) issues = issues.filter((i) => i.category === category);
  if (ruleId) issues = issues.filter((i) => i.ruleId === ruleId);

  const { page, pageSize } = parseOffsetPaging(sp);
  return NextResponse.json(paginate(issues, page, pageSize));
}
