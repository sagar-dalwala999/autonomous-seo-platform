import { NextRequest, NextResponse } from "next/server";
import { isSafeId, badRequest } from "@/lib/api-shared";
import { requireApiSession } from "@/lib/auth-guard";

/** GET /crawls/:id/pages/:pageId/screenshot?size=full|thumb — 302 to the existing working
 *  /api/screenshot route (same local-disk-vs-signed-URL reasoning as the html route). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string; pageId: string }> }) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const { runId, pageId } = await params;
  if (!isSafeId(runId) || !isSafeId(pageId)) return badRequest("Invalid run or page id.");
  const size = request.nextUrl.searchParams.get("size") === "full" ? "full" : "thumb";
  return NextResponse.redirect(new URL(`/api/screenshot/${encodeURIComponent(runId)}/${encodeURIComponent(pageId)}?size=${size}`, request.url), 302);
}
