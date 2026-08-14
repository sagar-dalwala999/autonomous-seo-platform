import { NextRequest, NextResponse } from "next/server";
import { buildGraph } from "@/lib/data-graph";
import { getRun } from "@/lib/data";
import { isSafeId, badRequest, notFound, parseOffsetPaging, paginate, cmp } from "@/lib/api-shared";
import { requireApiSession } from "@/lib/auth-guard";

/** GET /crawls/:id/graph — per-page depth, inlinks, outlinks, PageRank (spec §7). PageRank is
 *  computed live (lib/data-graph.ts) — no sibling "graph" store exists on disk for this. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const { runId } = await params;
  if (!isSafeId(runId)) return badRequest("Invalid runId.");
  const { report } = await getRun(runId);
  if (!report) return notFound(`No completed run found for "${runId}".`);

  let rows = await buildGraph(runId);
  const sp = request.nextUrl.searchParams;
  const sortKey = sp.get("sort") === "inlinks" ? "inlinks" : sp.get("sort") === "depth" ? "depth" : "pagerank";
  const order = sp.get("order") === "asc" ? "asc" : "desc";
  rows = [...rows].sort((a, b) => cmp(a[sortKey], b[sortKey], order));

  const { page, pageSize } = parseOffsetPaging(sp);
  return NextResponse.json(paginate(rows, page, pageSize));
}
