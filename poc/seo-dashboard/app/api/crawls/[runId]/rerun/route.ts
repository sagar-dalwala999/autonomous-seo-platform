import { NextResponse } from "next/server";
import { startCrawl, CrawlConflictError, CrawlValidationError } from "@/lib/crawl-runner";
import { rerunCrawl, CancelError } from "@/lib/crawl-control";
import { isSafeId, badRequest } from "@/lib/api-shared";
import { requireApiSession } from "@/lib/auth-guard";

/** POST /crawls/:id/rerun { overrides? } -> new crawl, same config as the original (minus auth,
 *  which is never persisted to disk — see crawl-control.ts's rerunCrawl doc). */
export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const { runId } = await params;
  if (!isSafeId(runId)) return badRequest("Invalid runId.");

  let overrides: Record<string, unknown> = {};
  try {
    const body = await request.json();
    if (body && typeof body === "object") overrides = (body as { overrides?: Record<string, unknown> }).overrides ?? {};
  } catch {
    // no body is fine — overrides stays {}
  }

  try {
    const base = await rerunCrawl(runId);
    const status = await startCrawl({ ...base, ...overrides });
    return NextResponse.json({ crawlId: status.runId, status }, { status: 202 });
  } catch (err) {
    if (err instanceof CancelError) return NextResponse.json({ error: { code: "NOT_FOUND", message: err.message } }, { status: err.status });
    if (err instanceof CrawlConflictError) return NextResponse.json({ error: { code: "CONFLICT", message: err.message, runningRunId: err.runningRunId } }, { status: 409 });
    if (err instanceof CrawlValidationError) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: err.message } }, { status: 422 });
    console.error("[api/crawls/:id/rerun] unexpected error", err);
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "Failed to rerun crawl." } }, { status: 500 });
  }
}
