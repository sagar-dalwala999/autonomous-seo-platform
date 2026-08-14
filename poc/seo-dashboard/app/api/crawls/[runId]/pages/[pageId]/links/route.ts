import { NextRequest, NextResponse } from "next/server";
import { getPage, getPages } from "@/lib/data";
import { isSafeId, badRequest, notFound, parseOffsetPaging, paginate } from "@/lib/api-shared";
import type { LinkRecord } from "@/lib/types";
import { requireApiSession } from "@/lib/auth-guard";

interface LinkRow extends LinkRecord {
  direction: "out" | "in";
  sourceUrl: string;
}

/** GET /crawls/:id/pages/:pageId/links?direction=out|in&kind=&status (spec §7). Inbound links are
 *  derived by scanning every page's outbound link list for a target matching this page — the
 *  crawler does not store a reverse index, so this is O(pages) per request (fine at POC scale;
 *  the /graph endpoint precomputes inlink COUNTS the same way for the whole run). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string; pageId: string }> }) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const { runId, pageId } = await params;
  if (!isSafeId(runId) || !isSafeId(pageId)) return badRequest("Invalid run or page id.");

  const page = await getPage(runId, pageId);
  if (!page) return notFound(`No page "${pageId}" found in run "${runId}".`);

  const sp = request.nextUrl.searchParams;
  const direction = sp.get("direction") === "in" ? "in" : sp.get("direction") === "out" ? "out" : "both";
  const kind = sp.get("kind");
  const statusFilter = sp.get("status");

  let rows: LinkRow[] = [];
  if (direction === "out" || direction === "both") {
    rows.push(...page.links.map((l) => ({ ...l, direction: "out" as const, sourceUrl: page.url })));
  }
  if (direction === "in" || direction === "both") {
    const allPages = await getPages(runId);
    for (const p of allPages) {
      if (p.pageId === pageId) continue;
      for (const l of p.links) {
        if (l.type === "internal" && l.targetNormalized === page.normalizedUrl) {
          rows.push({ ...l, direction: "in", sourceUrl: p.url });
        }
      }
    }
  }
  if (kind) rows = rows.filter((r) => r.type === kind);
  if (statusFilter) rows = rows.filter((r) => String(r.rel ?? "").includes(statusFilter));

  const { page: p, pageSize } = parseOffsetPaging(sp);
  return NextResponse.json(paginate(rows, p, pageSize));
}
