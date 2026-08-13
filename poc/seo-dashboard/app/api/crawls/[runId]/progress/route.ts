import { readdir } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getCrawlStatus, reportReady } from "@/lib/crawl-runner";
import { runsDirPath } from "@/lib/crawl-control";
import { getRun } from "@/lib/data";
import { isSafeId, badRequest, notFound } from "@/lib/api-shared";
import { requireApiSession } from "@/lib/auth-guard";

async function countPages(runId: string): Promise<number> {
  try {
    return (await readdir(path.join(runsDirPath(), runId, "pages"))).filter((f) => f.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

/** GET /crawls/:id/progress — non-streaming snapshot of the counters (spec §7). The live number
 *  during a running crawl; a finished crawl's numbers come straight from report.json. */
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const { runId } = await params;
  if (!isSafeId(runId)) return badRequest("Invalid runId.");

  const [status, ready] = await Promise.all([getCrawlStatus(runId), reportReady(runId)]);
  if (ready) {
    const { report } = await getRun(runId);
    if (report) {
      return NextResponse.json({
        state: "done",
        crawled: report.successful,
        discovered: report.discovered,
        failed: report.failed,
        blocked: report.blockedByRobots,
        rendered: report.jsRendered,
      });
    }
  }
  if (!status) return notFound(`No crawl found for runId "${runId}".`);
  const crawled = await countPages(runId);
  return NextResponse.json({ state: status.state, crawled, discovered: null, failed: null, blocked: null, rendered: null });
}
