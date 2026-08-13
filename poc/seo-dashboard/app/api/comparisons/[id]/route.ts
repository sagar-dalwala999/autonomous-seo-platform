import { NextRequest, NextResponse } from "next/server";
import { getComparison } from "@/lib/data-comparisons";
import { badRequest, notFound, parseOffsetPaging, paginate } from "@/lib/api-shared";
import { requireApiSession } from "@/lib/auth-guard";

/** GET /comparisons/:id?section=summary|pages|issues|measurements (spec §7). `measurements`
 *  section is not part of the stored CrawlDiff shape (data-compare.ts compares fields, not the
 *  measurement-grid namespace) — returns available:false rather than reusing `pages`' data under
 *  a different label. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const { id } = await params;
  const comparison = await getComparison(id);
  if (!comparison) return notFound(`No comparison found for id "${id}".`);

  const section = request.nextUrl.searchParams.get("section") ?? "summary";
  if (section === "measurements") {
    return NextResponse.json({ available: false, reason: "Measurement-level comparison is not part of the stored diff shape yet." });
  }
  if (section === "pages") {
    if (!comparison.runOverRun) return NextResponse.json({ available: false, reason: "This comparison is competitor mode — page-level diff is aggregate-only (spec §9.2)." });
    const { page, pageSize } = parseOffsetPaging(request.nextUrl.searchParams);
    return NextResponse.json(paginate(comparison.runOverRun.changed, page, pageSize));
  }
  if (section === "issues") {
    return NextResponse.json({ issues: comparison.runOverRun?.issues ?? null });
  }
  if (section === "summary") {
    return NextResponse.json({
      id: comparison.id,
      baseCrawlId: comparison.baseCrawlId,
      againstCrawlId: comparison.againstCrawlId,
      mode: comparison.mode,
      createdAt: comparison.createdAt,
      status: comparison.status,
      runOverRunSummary: comparison.runOverRun
        ? { added: comparison.runOverRun.added.length, removed: comparison.runOverRun.removed.length, changed: comparison.runOverRun.changed.length, unchanged: comparison.runOverRun.unchangedCount }
        : null,
      competitor: comparison.competitor,
    });
  }
  return badRequest(`Unknown section "${section}".`);
}
