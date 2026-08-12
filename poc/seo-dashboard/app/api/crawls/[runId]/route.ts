import { NextResponse } from "next/server";
import { getCrawlStatus, tailLog, reportReady } from "@/lib/crawl-runner";

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const status = await getCrawlStatus(runId);
  if (!status) {
    return NextResponse.json({ error: `No crawl status found for runId "${runId}".` }, { status: 404 });
  }
  const [log, ready] = await Promise.all([tailLog(runId, 30), reportReady(runId)]);
  return NextResponse.json({ ...status, log, reportReady: ready });
}
