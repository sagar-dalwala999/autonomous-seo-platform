import { NextRequest, NextResponse } from "next/server";
import { readAnalysisReport, groupIssuesByRule, SEVERITY_RANK } from "@/lib/data-issues";
import { isSafeId, badRequest, notFound, parseOffsetPaging, paginate } from "@/lib/api-shared";
import type { Issue, IssueSeverity } from "@/lib/types";
import { requireApiSession } from "@/lib/auth-guard";

/** GET /crawls/:id/issues?groupBy=rule|category|severity|page (default rule) + filters (spec §7).
 *  `rule` grouping reuses the existing groupIssuesByRule (lib/data-issues.ts, do-not-touch);
 *  category/severity/page grouping are new, simple aggregations over the same issue list. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const { runId } = await params;
  if (!isSafeId(runId)) return badRequest("Invalid runId.");

  const report = await readAnalysisReport(runId);
  if (!report) return notFound(`No analysis found for run "${runId}" — issues.json has not been produced yet.`);

  const sp = request.nextUrl.searchParams;
  let issues: Issue[] = report.issues;
  const severity = sp.get("severity") as IssueSeverity | null;
  const category = sp.get("category");
  const ruleId = sp.get("ruleId");
  const search = sp.get("search");
  if (severity) issues = issues.filter((i) => i.severity === severity);
  if (category) issues = issues.filter((i) => i.category === category);
  if (ruleId) issues = issues.filter((i) => i.ruleId === ruleId);
  if (search) {
    const needle = search.toLowerCase();
    issues = issues.filter((i) => i.message.toLowerCase().includes(needle) || i.ruleId.toLowerCase().includes(needle));
  }

  const groupBy = sp.get("groupBy") ?? "rule";
  const { page, pageSize } = parseOffsetPaging(sp);

  if (groupBy === "rule") {
    const groups = groupIssuesByRule(issues, report.pagesAnalyzed);
    return NextResponse.json(paginate(groups, page, pageSize));
  }
  if (groupBy === "category") {
    const map = new Map<string, Issue[]>();
    for (const i of issues) map.set(i.category, [...(map.get(i.category) ?? []), i]);
    const groups = [...map.entries()]
      .map(([category, items]) => ({ category, count: items.length, items }))
      .sort((a, b) => b.count - a.count);
    return NextResponse.json(paginate(groups, page, pageSize));
  }
  if (groupBy === "severity") {
    const map = new Map<IssueSeverity, Issue[]>();
    for (const i of issues) map.set(i.severity, [...(map.get(i.severity) ?? []), i]);
    const groups = [...map.entries()]
      .map(([sev, items]) => ({ severity: sev, count: items.length, items }))
      .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
    return NextResponse.json(paginate(groups, page, pageSize));
  }
  if (groupBy === "page") {
    const map = new Map<string, Issue[]>();
    for (const i of issues) {
      const key = i.pageId ?? i.url ?? "(site)";
      map.set(key, [...(map.get(key) ?? []), i]);
    }
    const groups = [...map.entries()]
      .map(([pageKey, items]) => ({ pageKey, count: items.length, items }))
      .sort((a, b) => b.count - a.count);
    return NextResponse.json(paginate(groups, page, pageSize));
  }

  return badRequest(`Unknown groupBy "${groupBy}" — expected rule, category, severity, or page.`);
}
