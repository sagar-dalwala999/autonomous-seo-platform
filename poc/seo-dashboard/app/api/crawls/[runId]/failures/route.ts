import { NextRequest, NextResponse } from "next/server";
import { getRun } from "@/lib/data";
import { isSafeId, badRequest, notFound, parseOffsetPaging, paginate } from "@/lib/api-shared";
import { requireApiSession } from "@/lib/auth-guard";

/** GET /crawls/:id/failures — pages that could not be fetched (spec §7), straight off failures.json. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const { runId } = await params;
  if (!isSafeId(runId)) return badRequest("Invalid runId.");
  const { report, failures } = await getRun(runId);
  if (!report) return notFound(`No completed run found for "${runId}".`);

  const sp = request.nextUrl.searchParams;
  const stage = sp.get("stage");
  const status = sp.get("status");
  let rows = failures;
  if (stage) rows = rows.filter((f) => f.reason === stage);
  if (status) rows = rows.filter((f) => String(f.statusCode ?? "") === status);

  const { page, pageSize } = parseOffsetPaging(sp);
  return NextResponse.json(paginate(rows, page, pageSize));
}
