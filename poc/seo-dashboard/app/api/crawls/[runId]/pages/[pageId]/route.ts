import { NextRequest, NextResponse } from "next/server";
import { getPage } from "@/lib/data";
import { isSafeId, badRequest, notFound } from "@/lib/api-shared";
import { requireApiSession } from "@/lib/auth-guard";

const INCLUDABLE = ["links", "images", "media", "structuredData", "headers", "vitals", "renderDivergence"] as const;

/** GET /crawls/:id/pages/:pageId — full stored record, trimmed by ?include= (spec §7). Default
 *  (no ?include) omits the heavy array fields so a page-list "click through" fetch stays small;
 *  pass ?include=links,images,... to get them. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string; pageId: string }> }) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const { runId, pageId } = await params;
  if (!isSafeId(runId) || !isSafeId(pageId)) return badRequest("Invalid run or page id.");

  const page = await getPage(runId, pageId);
  if (!page) return notFound(`No page "${pageId}" found in run "${runId}".`);

  const includeRaw = request.nextUrl.searchParams.get("include");
  const include = new Set((includeRaw ?? "").split(",").map((s) => s.trim()).filter((s) => (INCLUDABLE as readonly string[]).includes(s)));

  const { links, images, videos, structuredData, headers, ...rest } = page;
  const body: Record<string, unknown> = { ...rest };
  if (include.has("links")) body.links = links;
  if (include.has("images") || include.has("media")) body.images = images;
  if (include.has("media")) body.videos = videos;
  if (include.has("structuredData")) body.structuredData = structuredData;
  if (include.has("headers")) body.headers = headers;
  // renderDivergence already lives on `rest` when present, no trimming needed. `vitals` (LCP/CLS/
  // TBT) is accepted as an include value per spec §7 but CrawledPage has no vitals field yet
  // (PLAN-03 §3.5's vitals.* namespace is a sibling deliverable) — the flag is a no-op today.

  return NextResponse.json(body);
}
