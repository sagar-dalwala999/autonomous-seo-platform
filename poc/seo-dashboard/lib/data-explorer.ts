/** Server-only helpers for S10 routes. Never edit lib/data.ts (S9 owns it concurrently). */
import { getPages, getRun } from "./data";
import type { CrawledPageWithId, FailureRecord } from "./types";
import { type ExplorerRow, bucketForStatus } from "./explorer-shared";

export type { ExplorerRow, StatusBucket, SortKey, ExplorerFilterParams, SectionGroup } from "./explorer-shared";
export { STATUS_BUCKETS, SORT_KEYS, statusTone, sectionOf, filterAndSortRows, groupBySection } from "./explorer-shared";

/** Unifies pages/*.json + failures.json + blocked.json into one explorer row list (POC scale). */
export async function buildExplorerRows(runId: string): Promise<ExplorerRow[]> {
  const [{ items: pages }, { failures, blocked }] = await Promise.all([getPages(runId, {}), getRun(runId)]);

  const rows: ExplorerRow[] = pages.map((p) => ({
    key: `page-${p.pageId}`,
    url: p.url,
    pageId: p.pageId,
    bucket: bucketForStatus(p.statusCode),
    statusCode: p.statusCode,
    renderedWith: p.renderedWith,
    depth: p.crawl.depth,
    wordCount: p.content.wordCount,
    responseTimeMs: p.performance.responseTimeMs,
    reason: null,
  }));

  failures.forEach((f, i) => {
    rows.push({
      key: `failure-${i}-${f.url}`,
      url: f.url,
      pageId: null,
      bucket: "failed",
      statusCode: f.statusCode,
      renderedWith: null,
      depth: f.depth,
      wordCount: null,
      responseTimeMs: null,
      reason: f.reason,
    });
  });

  blocked.forEach((url, i) => {
    rows.push({
      key: `blocked-${i}-${url}`,
      url,
      pageId: null,
      bucket: "blocked",
      statusCode: null,
      renderedWith: null,
      depth: null,
      wordCount: null,
      responseTimeMs: null,
      reason: "blocked-robots",
    });
  });

  return rows;
}

export function groupFailuresByClass(failures: FailureRecord[]): { reason: string; items: FailureRecord[] }[] {
  const map = new Map<string, FailureRecord[]>();
  for (const f of failures) {
    const list = map.get(f.reason) ?? [];
    list.push(f);
    map.set(f.reason, list);
  }
  return [...map.entries()].map(([reason, items]) => ({ reason, items })).sort((a, b) => b.items.length - a.items.length);
}

/**
 * Cross-ref matches by pathname+search, host-agnostic (spec.md S5 note): sitemap entries are
 * authored (possibly aliased-host) URLs while page records store remapped normalized URLs.
 */
export function findPageIdByUrl(pages: CrawledPageWithId[], url: string): string | null {
  const key = pathKey(url);
  if (key === null) return null;
  for (const p of pages) {
    if (pathKey(p.url) === key || pathKey(p.normalizedUrl) === key) return p.pageId;
  }
  return null;
}

function pathKey(raw: string): string | null {
  try {
    const u = new URL(raw);
    return `${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}
