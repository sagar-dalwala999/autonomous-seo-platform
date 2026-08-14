import { NextResponse } from "next/server";
import { buildAiAccessTable } from "@/lib/data-sitefiles";
import { isSafeId, badRequest, notFound } from "@/lib/api-shared";
import { requireApiSession } from "@/lib/auth-guard";

/** GET /crawls/:id/site-files/ai-access — the 13-agent verdict table (spec §7 / §3.2), all four
 *  buckets always surfaced. Computed live from robots.json's raw content — see
 *  lib/data-sitefiles.ts for the parser's scope and limits (simplified group-matcher, not the
 *  crawler's authoritative most-specific-path-wins parser). `ignores-robots` cannot be derived
 *  from robots.txt text alone (it requires observing actual bot request behavior against the
 *  target), so that bucket is always empty here — documented, not silently dropped. */
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const { runId } = await params;
  if (!isSafeId(runId)) return badRequest("Invalid runId.");
  const result = await buildAiAccessTable(runId);
  if (!result) return notFound(`No robots.json found for run "${runId}".`);
  return NextResponse.json({
    rows: result.rows,
    parseStatus: result.parseStatus,
    note: "Verdicts derived from a simplified robots.txt group-matcher over stored robots.json content. 'ignores-robots' is always empty — that bucket needs observed bot behavior, not robots.txt parsing.",
  });
}
