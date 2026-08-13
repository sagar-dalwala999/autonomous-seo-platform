import { NextRequest, NextResponse } from "next/server";
import { listExports } from "@/lib/data-export";
import { parseOffsetPaging, paginate } from "@/lib/api-shared";
import { requireApiSession } from "@/lib/auth-guard";

/** GET /exports?crawlId= — list exports (spec §7). */
export async function GET(request: NextRequest) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const crawlId = request.nextUrl.searchParams.get("crawlId");
  const rows = await listExports(crawlId);
  const { page, pageSize } = parseOffsetPaging(request.nextUrl.searchParams);
  return NextResponse.json(paginate(rows, page, pageSize));
}
