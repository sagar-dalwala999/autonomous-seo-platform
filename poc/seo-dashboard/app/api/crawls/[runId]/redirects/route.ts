import { NextRequest, NextResponse } from "next/server";
import { getPages, getRun } from "@/lib/data";
import { isSafeId, badRequest, notFound, parseOffsetPaging, paginate } from "@/lib/api-shared";
import { requireApiSession } from "@/lib/auth-guard";

type RedirectType = "permanent" | "temporary" | "loop" | "to-error";

interface RedirectChainRow {
  pageId: string;
  url: string;
  chain: { from: string; to: string; statusCode: number }[];
  finalStatus: number | null;
  type: RedirectType;
}

function classify(chain: { statusCode: number }[], finalStatus: number | null): RedirectType {
  const urls = chain.map((c) => c.statusCode);
  if (finalStatus !== null && finalStatus >= 400) return "to-error";
  if (new Set(chain.map((c) => c.statusCode)).size < chain.length && chain.length > 3) return "loop"; // heuristic: repeated hop pattern in a long chain
  const allPermanent = urls.every((s) => s === 301 || s === 308);
  return allPermanent ? "permanent" : "temporary";
}

/** GET /crawls/:id/redirects — observed redirect chains (spec §7), read straight off each page's
 *  stored redirectChain[] (real data, no computation needed beyond classification). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const { runId } = await params;
  if (!isSafeId(runId)) return badRequest("Invalid runId.");
  const { report } = await getRun(runId);
  if (!report) return notFound(`No completed run found for "${runId}".`);

  const pages = await getPages(runId);
  let rows: RedirectChainRow[] = pages
    .filter((p) => p.redirectChain.length > 0)
    .map((p) => ({
      pageId: p.pageId,
      url: p.url,
      chain: p.redirectChain.map((r) => ({ from: r.from, to: r.to, statusCode: r.statusCode })),
      finalStatus: p.statusCode,
      type: classify(p.redirectChain, p.statusCode),
    }));

  const typeFilter = request.nextUrl.searchParams.get("type") as RedirectType | null;
  if (typeFilter) rows = rows.filter((r) => r.type === typeFilter);

  const { page, pageSize } = parseOffsetPaging(request.nextUrl.searchParams);
  return NextResponse.json(paginate(rows, page, pageSize));
}
