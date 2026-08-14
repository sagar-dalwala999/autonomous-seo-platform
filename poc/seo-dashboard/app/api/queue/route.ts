import { NextResponse } from "next/server";
import { findRunningCrawl, getCrawlStatus } from "@/lib/crawl-runner";
import { requireApiSession } from "@/lib/auth-guard";
import { listJobs } from "@/lib/data-queue";

/** GET /queue — queue depth, oldest queued age, running jobs, worker count (spec §7). This POC
 *  enforces one crawl at a time (crawl-runner.ts's CrawlConflictError) with no queue table behind
 *  it, so "queued" is always 0 by construction — real, not a placeholder: a second POST /crawls
 *  genuinely gets rejected with 409 rather than silently queuing. `workerCount` is this dev
 *  process itself (there is no separate worker process in this POC — see PLAN-03 §1's target
 *  shape, not yet built). */
export async function GET() {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const runningId = await findRunningCrawl();
  const running = runningId ? await getCrawlStatus(runningId) : null;
  const jobs = await listJobs();
  return NextResponse.json({
    queuedCount: 0,
    oldestQueuedAgeMs: null,
    runningCount: running ? 1 : 0,
    runningRunId: running?.runId ?? null,
    workerCount: 1,
    note: "This POC runs one crawl at a time in-process (no separate worker tier / job table yet — PLAN-03 §1 target architecture).",
    jobs,
  });
}
