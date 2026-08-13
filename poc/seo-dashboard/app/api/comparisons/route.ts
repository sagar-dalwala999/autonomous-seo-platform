import { NextRequest, NextResponse } from "next/server";
import { createComparison, listComparisons, ComparisonError, type ComparisonMode } from "@/lib/data-comparisons";
import { badRequest, parseOffsetPaging, paginate } from "@/lib/api-shared";
import { requireApiSession } from "@/lib/auth-guard";

/** POST /comparisons { baseCrawlId, againstCrawlId, mode } — previous-run or competitor
 *  comparison (spec §7, §9). Computed synchronously (POC scale) but the response shape matches
 *  the documented async contract: 202 + comparisonId. */
export async function POST(request: NextRequest) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Request body must be JSON.");
  }
  if (typeof body !== "object" || body === null) return badRequest("Request body must be a JSON object.");
  const { baseCrawlId, againstCrawlId, mode } = body as { baseCrawlId?: unknown; againstCrawlId?: unknown; mode?: unknown };
  if (typeof baseCrawlId !== "string" || !baseCrawlId) return badRequest("baseCrawlId is required.");
  if (typeof againstCrawlId !== "string" || !againstCrawlId) return badRequest("againstCrawlId is required.");
  const modeVal: ComparisonMode = mode === "competitor" ? "competitor" : "run-over-run";

  try {
    const result = await createComparison(baseCrawlId, againstCrawlId, modeVal);
    return NextResponse.json({ comparisonId: result.id, status: result.status }, { status: 202 });
  } catch (err) {
    if (err instanceof ComparisonError) return NextResponse.json({ error: { code: "NOT_FOUND", message: err.message } }, { status: err.status });
    console.error("[api/comparisons] unexpected error", err);
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "Failed to create comparison." } }, { status: 500 });
  }
}

/** GET /comparisons?siteId= — list saved comparisons. `siteId` has no meaning in this file-based
 *  POC (no site model — see §7's Projects & sites section, not built); accepts a runId instead so
 *  "comparisons touching this run" is still filterable. */
export async function GET(request: NextRequest) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const runIdFilter = request.nextUrl.searchParams.get("siteId");
  const rows = await listComparisons(runIdFilter);
  const { page, pageSize } = parseOffsetPaging(request.nextUrl.searchParams);
  return NextResponse.json(paginate(rows, page, pageSize));
}
