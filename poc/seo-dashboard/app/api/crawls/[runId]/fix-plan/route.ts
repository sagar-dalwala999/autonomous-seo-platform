import { NextRequest, NextResponse } from "next/server";
import { readAnalysisReport } from "@/lib/data-issues";
import { isSafeId, badRequest, notFound, parseOffsetPaging, paginate } from "@/lib/api-shared";
import type { AutomationLevel, EffortLevel } from "@/lib/types";
import { requireApiSession } from "@/lib/auth-guard";

/** GET /crawls/:id/fix-plan?includeReview=true (spec §7): "every auto-safe finding as a concrete
 *  per-URL change, applied: false". Automation tier now lives on report.findings (one row per rule,
 *  src/analysis/priority/priority.ts) — joined onto each issue here by ruleId, never guessed.
 *  Runs whose issues.json predates the priority slice (no report.findings) fall back to
 *  `automation: 'unknown'` per-item, same as before, with `automationAvailable: false` at the top
 *  level. `includeReview` stays accepted-but-unfiltered — no committed spec text pins down whether
 *  it should narrow the list, so this endpoint keeps returning every issue rather than guessing a
 *  filter behavior nobody asked for. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const { runId } = await params;
  if (!isSafeId(runId)) return badRequest("Invalid runId.");

  const report = await readAnalysisReport(runId);
  if (!report) return notFound(`No analysis found for run "${runId}".`);

  const automationAvailable = report.findings !== undefined;
  const findingByRule = new Map((report.findings ?? []).map((f) => [f.ruleId, f]));

  const items = report.issues.map((i) => {
    const finding = findingByRule.get(i.ruleId);
    return {
      ruleId: i.ruleId,
      url: i.url,
      pageId: i.pageId,
      message: i.message,
      change: i.howToFix,
      automation: (finding?.automation ?? "unknown") as AutomationLevel | "unknown",
      effort: (finding?.effort ?? null) as EffortLevel | null,
      confidence: finding?.confidence ?? null,
      applied: false,
      evidence: i.evidence,
    };
  });

  const { page, pageSize } = parseOffsetPaging(request.nextUrl.searchParams);
  return NextResponse.json({ ...paginate(items, page, pageSize), automationAvailable, includeReviewApplied: false });
}
