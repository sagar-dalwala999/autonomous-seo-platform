import { NextRequest, NextResponse } from "next/server";
import { startCrawl, getCrawlStatus, findRunningCrawl, CrawlConflictError, CrawlValidationError } from "@/lib/crawl-runner";
import { listRuns } from "@/lib/data";
import { parseOffsetPaging, paginate, cmp } from "@/lib/api-shared";
import { requireApiSession } from "@/lib/auth-guard";

/** GET ?status=running|completed&from&to&q&sort=startedAt|successful|coveragePercent&order&page&pageSize
 *  listRuns() only returns runs with a report.json (finished ones) — a crawl still in flight has
 *  none yet, so it is merged in here as a synthetic row, otherwise a running crawl would be
 *  invisible from the one list endpoint that is supposed to show queue+history together. */
export async function GET(request: NextRequest) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const sp = request.nextUrl.searchParams;
  const runs = await listRuns();
  type Row = (typeof runs)[number] & { status: "completed" | "running" };
  let rows: Row[] = runs.map((r) => ({ ...r, status: "completed" as const }));

  const runningId = await findRunningCrawl();
  if (runningId && !rows.some((r) => r.runId === runningId)) {
    const live = await getCrawlStatus(runningId);
    if (live) {
      rows = [
        {
          runId: live.runId,
          startUrl: live.startUrl,
          startedAt: live.startedAt,
          finishedAt: live.endedAt ?? "",
          attempted: 0,
          successful: 0,
          failed: 0,
          blockedByRobots: 0,
          coveragePercent: 0,
          maxDepthSeen: null,
          status: "running",
        },
        ...rows,
      ];
    }
  }

  const statusFilter = sp.get("status");
  if (statusFilter) rows = rows.filter((r) => r.status === statusFilter);
  const from = sp.get("from");
  const to = sp.get("to");
  if (from) rows = rows.filter((r) => r.startedAt >= from);
  if (to) rows = rows.filter((r) => r.startedAt <= to);
  const q = sp.get("q");
  if (q) rows = rows.filter((r) => r.startUrl.toLowerCase().includes(q.toLowerCase()) || r.runId.includes(q));

  const sortKey = (sp.get("sort") ?? "startedAt") as keyof Row;
  const order = sp.get("order") === "asc" ? "asc" : "desc";
  const allowedSort: (keyof Row)[] = ["startedAt", "successful", "coveragePercent", "failed"];
  if (allowedSort.includes(sortKey)) rows = [...rows].sort((a, b) => cmp(a[sortKey], b[sortKey], order));

  const { page, pageSize } = parseOffsetPaging(sp);
  return NextResponse.json(paginate(rows, page, pageSize));
}

/** POST { startUrl, maxPages?, respectRobots?, render?, screenshots?, aliases? } -> spawns a real crawl. */
export async function POST(request: Request) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }

  try {
    // Server-side validation mirrors the client form — never trust it.
    const status = await startCrawl(body as Parameters<typeof startCrawl>[0]);
    return NextResponse.json(status, { status: 202 });
  } catch (err) {
    if (err instanceof CrawlConflictError) {
      return NextResponse.json({ error: err.message, runningRunId: err.runningRunId }, { status: 409 });
    }
    if (err instanceof CrawlValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[api/crawls] unexpected error", err);
    return NextResponse.json({ error: "Failed to start crawl." }, { status: 500 });
  }
}
