import { NextRequest, NextResponse } from "next/server";
import { isSafeId, badRequest } from "@/lib/api-shared";
import { requireApiSession } from "@/lib/auth-guard";

/** GET /crawls/:id/pages/:pageId/html?variant=static|rendered — spec §7 calls for a signed-URL
 *  redirect to Supabase Storage; this POC stores artifacts on local disk, so the honest same-origin
 *  equivalent is a 302 to the existing /api/raw route (static variant only — that's all that
 *  route serves today; a "rendered" request 404s there rather than silently returning static). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string; pageId: string }> }) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const { runId, pageId } = await params;
  if (!isSafeId(runId) || !isSafeId(pageId)) return badRequest("Invalid run or page id.");
  const variant = request.nextUrl.searchParams.get("variant") === "rendered" ? "rendered" : "static";
  if (variant === "rendered") {
    return NextResponse.redirect(new URL(`/api/replay/${encodeURIComponent(runId)}/${encodeURIComponent(pageId)}?variant=rendered`, request.url), 302);
  }
  return NextResponse.redirect(new URL(`/api/raw/${encodeURIComponent(runId)}/${encodeURIComponent(pageId)}`, request.url), 302);
}
