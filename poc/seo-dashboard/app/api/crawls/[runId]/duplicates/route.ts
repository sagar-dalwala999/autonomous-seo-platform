import { NextRequest, NextResponse } from "next/server";
import { buildDuplicates } from "@/lib/data-graph";
import { getRun } from "@/lib/data";
import { isSafeId, badRequest, notFound, parseOffsetPaging, paginate } from "@/lib/api-shared";
import { requireApiSession } from "@/lib/auth-guard";

/** GET /crawls/:id/duplicates?kind=exact|near|title|description (spec §7). exact/title/description
 *  are cheap O(n) groupings over real stored fields; near is capped — see lib/data-graph.ts. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const { runId } = await params;
  if (!isSafeId(runId)) return badRequest("Invalid runId.");
  const { report } = await getRun(runId);
  if (!report) return notFound(`No completed run found for "${runId}".`);

  const kindRaw = request.nextUrl.searchParams.get("kind");
  const kind = kindRaw === "near" || kindRaw === "title" || kindRaw === "description" ? kindRaw : "exact";
  const result = await buildDuplicates(runId, kind);
  if (!result.available) return NextResponse.json({ data: [], page: { page: 1, pageSize: 0, total: 0, hasMore: false }, meta: { available: false, reason: result.reason } });

  const { page, pageSize } = parseOffsetPaging(request.nextUrl.searchParams);
  return NextResponse.json({ ...paginate(result.groups, page, pageSize), meta: { available: true } });
}
