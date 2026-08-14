/** Server-only. New lib file for the API-surface expansion (S-API). Builds the PageRow
 *  projection + filter/sort used by GET /api/crawls/:id/pages, layered on streamPages and
 *  readAnalysisReport — never re-implements either. */
import { streamPages } from "./data";
import { readAnalysisReport } from "./data-issues";
import { buildGraph } from "./data-graph";
import type { AnalysisReport, CrawledPageWithId, Issue, IssueSeverity } from "./types";

export interface PageRow {
  pageId: string;
  url: string;
  status: number | null;
  depth: number | null;
  title: string | null;
  indexable: boolean;
  rendered: "http" | "playwright";
  ttfbMs: number | null;
  responseTimeMs: number | null;
  wordCount: number | null;
  issueCounts: Record<IssueSeverity, number>;
  section: string;
  pagerank: number | null;
  inlinks: number | null;
}

function sectionOf(url: string): string {
  try {
    return new URL(url).pathname.split("/").filter(Boolean)[0] ?? "(root)";
  } catch {
    return "(root)";
  }
}

/** A page is indexable iff it served 2xx, has no meta/X-Robots noindex, and isn't robots-blocked
 *  (blocked pages never reach getPages — they live in blocked.json, a separate list). */
function isIndexable(p: CrawledPageWithId): boolean {
  return p.statusCode !== null && p.statusCode < 300 && !p.robots.noindex;
}

/** Built once per request, not per page — O(issues) instead of O(pages x issues). */
function buildIssueIndex(report: AnalysisReport | null): Map<string, Issue[]> {
  const map = new Map<string, Issue[]>();
  if (!report) return map;
  const add = (pageId: string, issue: Issue) => {
    const list = map.get(pageId) ?? [];
    list.push(issue);
    map.set(pageId, list);
  };
  for (const issue of report.issues) {
    if (issue.pageId) add(issue.pageId, issue);
    for (const e of issue.evidence) if (e.pageId && e.pageId !== issue.pageId) add(e.pageId, issue);
  }
  return map;
}

function emptyCounts(): Record<IssueSeverity, number> {
  return { error: 0, warning: 0, notice: 0 };
}

export interface PagesFilter {
  status?: string | null; // "2xx" | "3xx" | "4xx" | "5xx" | exact code
  depth?: number | null;
  indexable?: boolean | null;
  hasIssues?: boolean | null;
  severity?: IssueSeverity | null;
  ruleId?: string | null;
  rendered?: "http" | "playwright" | null;
  minWords?: number | null;
  maxWords?: number | null;
  search?: string | null;
  section?: string | null;
}

export type PagesSortKey = "url" | "status" | "depth" | "ttfb" | "words" | "issues" | "pagerank";

function matchesStatusFilter(status: number | null, filter: string): boolean {
  if (status === null) return false;
  if (/^\d{3}$/.test(filter)) return status === Number(filter);
  const bucket = Math.floor(status / 100);
  return `${bucket}xx` === filter;
}

function toRow(
  p: CrawledPageWithId,
  pageIssues: Issue[],
  graphInfo?: { pagerank: number; inlinks: number },
): PageRow {
  const counts = emptyCounts();
  for (const i of pageIssues) counts[i.severity]++;
  return {
    pageId: p.pageId,
    url: p.url,
    status: p.statusCode,
    depth: p.crawl.depth,
    title: p.title,
    indexable: isIndexable(p),
    rendered: p.renderedWith,
    ttfbMs: null,
    responseTimeMs: p.performance.responseTimeMs,
    wordCount: p.content.wordCount,
    issueCounts: counts,
    section: sectionOf(p.url),
    pagerank: graphInfo?.pagerank ?? null,
    inlinks: graphInfo?.inlinks ?? null,
  };
}

function matchesFilter(row: PageRow, filter: PagesFilter, pageIssues: Issue[]): boolean {
  if (filter.status && !matchesStatusFilter(row.status, filter.status)) return false;
  if (filter.depth !== undefined && filter.depth !== null && row.depth !== filter.depth) return false;
  if (filter.indexable !== undefined && filter.indexable !== null && row.indexable !== filter.indexable) return false;
  if (filter.rendered && row.rendered !== filter.rendered) return false;
  if (filter.minWords !== undefined && filter.minWords !== null && (row.wordCount ?? 0) < filter.minWords) return false;
  if (filter.maxWords !== undefined && filter.maxWords !== null && (row.wordCount ?? 0) > filter.maxWords) return false;
  if (filter.section && row.section !== filter.section) return false;
  if (filter.search) {
    const needle = filter.search.toLowerCase();
    if (!row.url.toLowerCase().includes(needle) && !(row.title ?? "").toLowerCase().includes(needle)) return false;
  }
  if (filter.hasIssues && row.issueCounts.error + row.issueCounts.warning + row.issueCounts.notice === 0) return false;
  if (filter.severity && row.issueCounts[filter.severity] === 0) return false;
  if (filter.ruleId && !pageIssues.some((i) => i.ruleId === filter.ruleId)) return false;
  return true;
}

export async function buildPageRows(runId: string, filter: PagesFilter): Promise<PageRow[]> {
  const [report, graphRows] = await Promise.all([
    readAnalysisReport(runId),
    buildGraph(runId).catch(() => []),
  ]);
  const issueIndex = buildIssueIndex(report);

  const graphMap = new Map<string, { pagerank: number; inlinks: number }>();
  for (const g of graphRows) {
    graphMap.set(g.pageId, { pagerank: g.pagerank, inlinks: g.inlinks });
  }

  const rows: PageRow[] = [];
  for await (const p of streamPages(runId)) {
    const pageIssues = issueIndex.get(p.pageId) ?? [];
    const graphInfo = graphMap.get(p.pageId);
    const row = toRow(p, pageIssues, graphInfo);
    if (matchesFilter(row, filter, pageIssues)) rows.push(row);
  }
  return rows;
}

export function sortValueFor(row: PageRow, key: PagesSortKey): string | number | null {
  switch (key) {
    case "url":
      return row.url;
    case "status":
      return row.status;
    case "depth":
      return row.depth;
    case "ttfb":
      return row.responseTimeMs;
    case "words":
      return row.wordCount;
    case "issues":
      return row.issueCounts.error * 100 + row.issueCounts.warning * 10 + row.issueCounts.notice;
    case "pagerank":
      return row.pagerank;
  }
}
