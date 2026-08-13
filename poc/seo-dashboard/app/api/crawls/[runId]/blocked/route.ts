import { NextRequest, NextResponse } from "next/server";
import { getRun, readSkipped } from "@/lib/data";
import { isSafeId, badRequest, notFound, parseOffsetPaging, paginate } from "@/lib/api-shared";
import { requireApiSession } from "@/lib/auth-guard";

type BlockedReason = "robots" | "safety-denylist" | "user-excluded";

interface BlockedRow {
  url: string;
  reason: BlockedReason;
  detail: string | null;
}

/** GET /crawls/:id/blocked — robots-blocked + safety-denylist-skipped (spec §7), merging
 *  blocked.json (robots) and skipped.json (safety guard rails, B3). SSRF-blocked and
 *  scope-excluded URLs are not recorded anywhere on disk yet — not fabricated here. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const { runId } = await params;
  if (!isSafeId(runId)) return badRequest("Invalid runId.");
  const { report, blocked } = await getRun(runId);
  if (!report) return notFound(`No completed run found for "${runId}".`);
  const skipped = await readSkipped(runId);

  let rows: BlockedRow[] = [
    ...blocked.map((url): BlockedRow => ({ url, reason: "robots", detail: null })),
    ...skipped.map(
      (s): BlockedRow => ({ url: s.url, reason: s.reason === "user-excluded" ? "user-excluded" : "safety-denylist", detail: `matched "${s.matchedPattern}" on ${s.foundOn ?? "(unknown)"}` }),
    ),
  ];

  const reasonFilter = request.nextUrl.searchParams.get("reason") as BlockedReason | null;
  if (reasonFilter) rows = rows.filter((r) => r.reason === reasonFilter);

  const { page, pageSize } = parseOffsetPaging(request.nextUrl.searchParams);
  return NextResponse.json({
    ...paginate(rows, page, pageSize),
    meta: { ssrfBlockedAvailable: false, scopeExcludedAvailable: false, limitTruncatedAvailable: false },
  });
}
