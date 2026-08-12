/**
 * Server-only (node:fs via lib/data.ts + lib/data-issues.ts). Never import this from a "use
 * client" file. Computes the crawl-over-crawl diff ON THE FLY rather than reading a stored
 * storage/diffs/*.json — the dashboard has no build step to keep a cached file current, and the
 * page-count here is POC scale, so recomputing per request is simpler and always matches what's
 * on disk. Mirrors seo-crawler-poc's src/diff/crawlDiff.ts algorithm field-for-field (kept in
 * sync manually — same cross-project fallback rationale as lib/types.ts's header comment: no TS
 * project reference between the two sibling apps).
 */
import { getPages } from "./data";
import { readAnalysisReport } from "./data-issues";
import type { CrawledPageWithId } from "./types";

export interface PageFieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface PageChange {
  url: string;
  pageId: string;
  changes: PageFieldChange[];
}

export interface CrawlDiff {
  baseRunId: string;
  headRunId: string;
  generatedAt: string;
  /** URLs present in head but not base. */
  added: string[];
  /** URLs present in base but not head. */
  removed: string[];
  changed: PageChange[];
  unchangedCount: number;
  /** Issue lifecycle when BOTH runs have been analyzed; null otherwise (honest, not zero). */
  issues: { newIssues: string[]; fixedIssues: string[]; persistingCount: number } | null;
}

/** Path-only key, trailing slash stripped except root — survives host aliasing / scheme drift
 * between two crawls of the same site. Mirrors the crawler's pathnameOf convention. */
function pathKey(raw: string): string {
  try {
    const p = new URL(raw).pathname;
    return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
  } catch {
    return raw;
  }
}

function byKey(pages: CrawledPageWithId[]): Map<string, CrawledPageWithId> {
  const map = new Map<string, CrawledPageWithId>();
  for (const p of pages) map.set(pathKey(p.normalizedUrl ?? p.url), p);
  return map;
}

/** Same field set as the crawler CLI — content changes are detected via contentHash, never by
 * diffing extracted text. */
const FIELDS: { field: string; get: (p: CrawledPageWithId) => unknown }[] = [
  { field: "statusCode", get: (p) => p.statusCode },
  { field: "title", get: (p) => p.title },
  { field: "metaDescription", get: (p) => p.metaDescription },
  { field: "canonical", get: (p) => p.canonical },
  { field: "robots.noindex", get: (p) => p.robots.noindex },
  { field: "h1", get: (p) => p.headings.h1.join(" | ") },
  { field: "content.contentHash", get: (p) => p.content.contentHash },
  { field: "content.wordCount", get: (p) => p.content.wordCount },
  { field: "links.length", get: (p) => p.links.length },
  { field: "images.length", get: (p) => p.images.length },
  { field: "redirectChain.length", get: (p) => p.redirectChain.length },
  { field: "renderedWith", get: (p) => p.renderedWith },
];

function diffPage(base: CrawledPageWithId, head: CrawledPageWithId): PageFieldChange[] {
  const changes: PageFieldChange[] = [];
  for (const { field, get } of FIELDS) {
    const before = get(base);
    const after = get(head);
    if (before !== after) changes.push({ field, before, after });
  }
  return changes;
}

function issueKey(ruleId: string, url: string | null): string {
  return `${ruleId}::${url ?? "(site)"}`;
}

export async function computeDiff(baseRunId: string, headRunId: string): Promise<CrawlDiff> {
  const [{ items: basePages }, { items: headPages }, baseReport, headReport] = await Promise.all([
    getPages(baseRunId, {}),
    getPages(headRunId, {}),
    readAnalysisReport(baseRunId),
    readAnalysisReport(headRunId),
  ]);

  const baseMap = byKey(basePages);
  const headMap = byKey(headPages);

  const added = [...headMap.keys()]
    .filter((k) => !baseMap.has(k))
    .map((k) => headMap.get(k)!.url)
    .sort();
  const removed = [...baseMap.keys()]
    .filter((k) => !headMap.has(k))
    .map((k) => baseMap.get(k)!.url)
    .sort();

  const changed: PageChange[] = [];
  let unchangedCount = 0;
  for (const [key, headPage] of headMap) {
    const basePage = baseMap.get(key);
    if (!basePage) continue;
    const fieldChanges = diffPage(basePage, headPage);
    if (fieldChanges.length === 0) {
      unchangedCount++;
      continue;
    }
    changed.push({ url: headPage.url, pageId: headPage.pageId, changes: fieldChanges });
  }
  changed.sort((a, b) => a.url.localeCompare(b.url));

  let issues: CrawlDiff["issues"] = null;
  if (baseReport && headReport) {
    const baseKeys = new Set(baseReport.issues.map((i) => issueKey(i.ruleId, i.url)));
    const headKeys = new Set(headReport.issues.map((i) => issueKey(i.ruleId, i.url)));
    const newIssues = [...headKeys].filter((k) => !baseKeys.has(k)).sort();
    const fixedIssues = [...baseKeys].filter((k) => !headKeys.has(k)).sort();
    const persistingCount = [...headKeys].filter((k) => baseKeys.has(k)).length;
    issues = { newIssues, fixedIssues, persistingCount };
  }

  return {
    baseRunId,
    headRunId,
    generatedAt: new Date().toISOString(),
    added,
    removed,
    changed,
    unchangedCount,
    issues,
  };
}
