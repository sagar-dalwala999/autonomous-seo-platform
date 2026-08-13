import { NextRequest, NextResponse } from "next/server";
import { getPage } from "@/lib/data";
import { readAnalysisReport, findingsForPage } from "@/lib/data-issues";
import { isSafeId, badRequest, notFound, parseOffsetPaging, paginate } from "@/lib/api-shared";
import { requireApiSession } from "@/lib/auth-guard";

/** GET /crawls/:id/pages/:pageId/issues — findings on this page with evidence (spec §7). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string; pageId: string }> }) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const { runId, pageId } = await params;
  if (!isSafeId(runId) || !isSafeId(pageId)) return badRequest("Invalid run or page id.");

  const page = await getPage(runId, pageId);
  if (!page) return notFound(`No page "${pageId}" found in run "${runId}".`);

  const report = await readAnalysisReport(runId);
  const findings = report ? findingsForPage(report, pageId) : [];
  const { page: p, pageSize } = parseOffsetPaging(request.nextUrl.searchParams);
  return NextResponse.json({ ...paginate(findings, p, pageSize), analysisAvailable: report !== null });
}
