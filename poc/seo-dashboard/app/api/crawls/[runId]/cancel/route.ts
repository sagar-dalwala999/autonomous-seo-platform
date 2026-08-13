import { NextResponse } from "next/server";
import { cancelCrawl, CancelError } from "@/lib/crawl-control";
import { isSafeId, badRequest } from "@/lib/api-shared";
import { requireApiSession } from "@/lib/auth-guard";

/** POST /crawls/:id/cancel — real cancellation (process-tree kill), not a client-side no-op
 *  (PLAN-03 §2.4). Returns 202 with the reconciled status; the caller should poll GET /crawls/:id
 *  until state settles, same pattern the existing new-crawl page already uses. */
export async function POST(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const { runId } = await params;
  if (!isSafeId(runId)) return badRequest("Invalid runId.");
  try {
    const status = await cancelCrawl(runId);
    return NextResponse.json({ status: "cancelling", crawl: status }, { status: 202 });
  } catch (err) {
    if (err instanceof CancelError) return NextResponse.json({ error: { code: "CANCEL_ERROR", message: err.message } }, { status: err.status });
    console.error("[api/crawls/:id/cancel] unexpected error", err);
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "Failed to cancel crawl." } }, { status: 500 });
  }
}
