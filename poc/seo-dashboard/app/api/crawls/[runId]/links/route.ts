import { NextRequest, NextResponse } from "next/server";
import { getPages, getRun } from "@/lib/data";
import { isSafeId, badRequest, notFound, parseOffsetPaging, paginate } from "@/lib/api-shared";
import type { LinkRecord } from "@/lib/types";
import { requireApiSession } from "@/lib/auth-guard";

interface Edge extends LinkRecord {
  sourcePageId: string;
  broken: boolean;
}

/** GET /crawls/:id/links — full edge list (spec §7). "broken" is derived by matching the target
 *  against the crawled page set's status codes where resolvable; external targets have no crawled
 *  status in this POC (no external-link-check pass on disk yet), so `broken` is `false` for those
 *  rather than a guess. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const { runId } = await params;
  if (!isSafeId(runId)) return badRequest("Invalid runId.");
  const { report } = await getRun(runId);
  if (!report) return notFound(`No completed run found for "${runId}".`);

  const pages = await getPages(runId);
  const statusByNormUrl = new Map(pages.map((p) => [p.normalizedUrl, p.statusCode]));

  const sp = request.nextUrl.searchParams;
  const kind = sp.get("kind");
  const fromDepth = sp.get("fromDepth") !== null ? Number(sp.get("fromDepth")) : null;

  let edges: Edge[] = [];
  for (const p of pages) {
    if (fromDepth !== null && p.crawl.depth !== fromDepth) continue;
    for (const l of p.links) {
      if (kind && l.type !== kind) continue;
      const targetStatus = l.targetNormalized ? (statusByNormUrl.get(l.targetNormalized) ?? null) : null;
      edges.push({ ...l, sourcePageId: p.pageId, broken: targetStatus !== null && targetStatus >= 400 });
    }
  }
  const statusFilter = sp.get("status");
  if (statusFilter === "broken") edges = edges.filter((e) => e.broken);

  const { page, pageSize } = parseOffsetPaging(sp);
  return NextResponse.json(paginate(edges, page, pageSize));
}
