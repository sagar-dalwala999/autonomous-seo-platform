import { NextResponse } from "next/server";
import { startCrawl, CrawlConflictError, CrawlValidationError } from "@/lib/crawl-runner";

/** POST { startUrl, maxPages?, respectRobots?, render?, aliases? } -> spawns a real crawl. */
export async function POST(request: Request) {
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
