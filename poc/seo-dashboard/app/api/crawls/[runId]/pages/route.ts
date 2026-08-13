import { NextRequest, NextResponse } from "next/server";
import { buildPageRows, sortValueFor, type PagesFilter, type PagesSortKey } from "@/lib/data-pages";
import { isSafeId, badRequest, cursorPaginate, isApiErrorBody, cmp } from "@/lib/api-shared";
import { getRun } from "@/lib/data";
import { requireApiSession } from "@/lib/auth-guard";

const SORT_KEYS: PagesSortKey[] = ["url", "status", "depth", "ttfb", "words", "issues"];

/** GET /crawls/:id/pages — server-side filter + sort + CURSOR pagination (spec §7). Cursor, not
 *  offset: a 1,051/1,195-page run must never require the client to hold or re-fetch the full set. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const { runId } = await params;
  if (!isSafeId(runId)) return badRequest("Invalid runId.");
  const { report } = await getRun(runId);
  if (!report) return badRequest(`No completed run found for "${runId}".`);

  const sp = request.nextUrl.searchParams;
  const filter: PagesFilter = {
    status: sp.get("status"),
    depth: sp.get("depth") !== null ? Number(sp.get("depth")) : null,
    indexable: sp.get("indexable") !== null ? sp.get("indexable") === "true" : null,
    hasIssues: sp.get("hasIssues") === "true",
    severity: sp.get("severity") as PagesFilter["severity"],
    ruleId: sp.get("ruleId"),
    rendered: sp.get("rendered") as PagesFilter["rendered"],
    minWords: sp.get("minWords") !== null ? Number(sp.get("minWords")) : null,
    maxWords: sp.get("maxWords") !== null ? Number(sp.get("maxWords")) : null,
    search: sp.get("search"),
    section: sp.get("section"),
  };

  let rows = await buildPageRows(runId, filter);

  const sortRaw = sp.get("sort");
  const sortKey: PagesSortKey = SORT_KEYS.includes(sortRaw as PagesSortKey) ? (sortRaw as PagesSortKey) : "url";
  const order = sp.get("order") === "desc" ? "desc" : "asc";
  rows = [...rows].sort((a, b) => cmp(sortValueFor(a, sortKey), sortValueFor(b, sortKey), order));

  const result = cursorPaginate(rows, sp);
  if (isApiErrorBody(result)) return NextResponse.json(result, { status: 422 });
  return NextResponse.json(result);
}
