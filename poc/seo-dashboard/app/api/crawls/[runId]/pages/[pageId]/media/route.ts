import { NextRequest, NextResponse } from "next/server";
import { getPage } from "@/lib/data";
import { isSafeId, badRequest, notFound, parseOffsetPaging, paginate } from "@/lib/api-shared";
import { requireApiSession } from "@/lib/auth-guard";

/** GET /crawls/:id/pages/:pageId/media?kind=image|video|font|favicon (spec §7). Images/videos are
 *  always inventoried; fonts/favicons only when this page's record has them (older runs predate
 *  those extractors — absent, not empty, per lib/types.ts's optional-field convention). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string; pageId: string }> }) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const { runId, pageId } = await params;
  if (!isSafeId(runId) || !isSafeId(pageId)) return badRequest("Invalid run or page id.");

  const page = await getPage(runId, pageId);
  if (!page) return notFound(`No page "${pageId}" found in run "${runId}".`);

  const kind = request.nextUrl.searchParams.get("kind");
  const rows: { kind: string; item: unknown }[] = [];
  if (!kind || kind === "image") for (const img of page.images) rows.push({ kind: "image", item: img });
  if (!kind || kind === "video") for (const v of page.videos ?? []) rows.push({ kind: "video", item: v });
  if (!kind || kind === "font") for (const f of page.fonts?.faces ?? []) rows.push({ kind: "font", item: f });
  if (!kind || kind === "favicon") for (const f of page.favicons?.candidates ?? []) rows.push({ kind: "favicon", item: f });

  const { page: p, pageSize } = parseOffsetPaging(request.nextUrl.searchParams);
  return NextResponse.json({
    ...paginate(rows, p, pageSize),
    meta: {
      fontsAvailable: page.fonts !== undefined,
      faviconsAvailable: page.favicons !== undefined,
    },
  });
}
