import { NextRequest, NextResponse } from "next/server";
import { getRun } from "@/lib/data";
import { readAnalysisReport } from "@/lib/data-issues";
import { siteKeyFromStartUrl, muteRule, unmuteRule, reanalyzeAndWait } from "@/lib/mutes";
import { isSafeId, badRequest, notFound, apiError } from "@/lib/api-shared";
import { requireApiSession } from "@/lib/auth-guard";

interface MuteBody {
  runId?: string;
  ruleId?: string;
  note?: string;
}

async function resolveSiteKey(runId: string): Promise<string | null | { error: NextResponse }> {
  const { report } = await getRun(runId);
  if (!report) return { error: notFound(`No crawl found for run "${runId}".`) };
  return siteKeyFromStartUrl(report.startUrl);
}

/** POST /api/mutes {runId, ruleId, note?} — mute a rule for the run's site (keyed by start-URL
 *  host, not by run — see lib/mutes.ts), then re-run the rules engine synchronously so the caller
 *  gets the recomputed health score/findings back in one round trip, not a stale read. */
export async function POST(request: NextRequest) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const body = (await request.json().catch(() => ({}))) as MuteBody;
  const { runId, ruleId, note } = body;
  if (!runId || !isSafeId(runId)) return badRequest("runId is required and must be a safe id.");
  if (!ruleId || !isSafeId(ruleId)) return badRequest("ruleId is required and must be a safe id.");

  const siteKey = await resolveSiteKey(runId);
  if (siteKey && typeof siteKey === "object") return siteKey.error;
  if (!siteKey) return badRequest(`Run "${runId}" has no resolvable start-URL host to key the mute store by.`);

  try {
    await muteRule(siteKey, ruleId, { note, mutedBy: "dashboard" });
    await reanalyzeAndWait(runId);
  } catch (err) {
    console.error("[api/mutes] POST failed", err);
    return apiError(500, "MUTE_FAILED", err instanceof Error ? err.message : "Failed to mute and reanalyze.");
  }

  const report = await readAnalysisReport(runId);
  return NextResponse.json({
    ok: true,
    action: "mute",
    ruleId,
    healthScore: report?.healthScore ?? null,
    mutedRuleIds: report?.mutedRuleIds ?? [],
  });
}

/** DELETE /api/mutes {runId, ruleId} — unmute, then reanalyze. Findings are never deleted by a
 *  mute (see engine.ts): unmuting just flips the finding's status back and restores its damage. */
export async function DELETE(request: NextRequest) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const body = (await request.json().catch(() => ({}))) as MuteBody;
  const { runId, ruleId } = body;
  if (!runId || !isSafeId(runId)) return badRequest("runId is required and must be a safe id.");
  if (!ruleId || !isSafeId(ruleId)) return badRequest("ruleId is required and must be a safe id.");

  const siteKey = await resolveSiteKey(runId);
  if (siteKey && typeof siteKey === "object") return siteKey.error;
  if (!siteKey) return badRequest(`Run "${runId}" has no resolvable start-URL host to key the mute store by.`);

  try {
    await unmuteRule(siteKey, ruleId);
    await reanalyzeAndWait(runId);
  } catch (err) {
    console.error("[api/mutes] DELETE failed", err);
    return apiError(500, "UNMUTE_FAILED", err instanceof Error ? err.message : "Failed to unmute and reanalyze.");
  }

  const report = await readAnalysisReport(runId);
  return NextResponse.json({
    ok: true,
    action: "unmute",
    ruleId,
    healthScore: report?.healthScore ?? null,
    mutedRuleIds: report?.mutedRuleIds ?? [],
  });
}
