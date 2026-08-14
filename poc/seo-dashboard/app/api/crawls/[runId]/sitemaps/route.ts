import { NextRequest, NextResponse } from "next/server";
import { getRun, getPages } from "@/lib/data";
import { isSafeId, badRequest, notFound, parseOffsetPaging, paginate } from "@/lib/api-shared";
import { requireApiSession } from "@/lib/auth-guard";

/** GET /crawls/:id/sitemaps — sitemap URL inventory + coverage vs crawled (spec §7). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const { runId } = await params;
  if (!isSafeId(runId)) return badRequest("Invalid runId.");
  const { report, sitemaps } = await getRun(runId);
  if (!report) return notFound(`No completed run found for "${runId}".`);
  if (!sitemaps) return notFound(`No sitemaps.json found for run "${runId}".`);

  const pages = await getPages(runId);
  const crawledUrls = new Set(pages.map((p) => p.normalizedUrl));

  const sp = request.nextUrl.searchParams;
  let rows = sitemaps.entries.map((e) => ({ ...e, inCrawl: crawledUrls.has(e.url) }));
  if (sp.get("inSitemapOnly") === "true") rows = rows.filter((r) => r.inCrawl);
  if (sp.get("notInSitemap") === "true") rows = rows.filter((r) => !r.inCrawl);

  const { page, pageSize } = parseOffsetPaging(sp);
  return NextResponse.json({ ...paginate(rows, page, pageSize), files: sitemaps.files, errors: sitemaps.errors });
}
