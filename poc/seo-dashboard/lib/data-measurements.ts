/** Server-only. New lib file. Aggregate metrics for GET /api/crawls/:id/measurements — every
 *  number computed live from getPages()/getRun() (do-not-touch), nothing pre-materialized.
 *  Fields the stored CrawledPage/CrawlSummary schema does not yet carry (true http.ttfbMs split
 *  from render wall time per PLAN-03 §3.5, page byte weight) are returned with `available: false`
 *  rather than a fabricated number — see each metric's comment. */
import { getPages, getRun } from "./data";
import type { CrawledPageWithId, CrawlSummary } from "./types";

export interface Histogram {
  buckets: { key: string; count: number }[];
  available: true;
}

export interface Percentiles {
  p50: number | null;
  p75: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
  available: true;
  /** Honest caveat, not a bug fix: PLAN-03 §3.5 (M4) requires http.ttfbMs and render.wallMs to
   *  live in separate namespaces because browser wall-clock time on rendered pages otherwise
   *  produces false "slow page" findings (measured: 76.6% of rendered pages in the M4 audit).
   *  This POC's stored CrawledPage only has one `performance.responseTimeMs` field — the split
   *  has not shipped yet. These percentiles are that single field; do not read them as true TTFB. */
  caveat: string;
}

export interface Unavailable {
  available: false;
  reason: string;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function computePercentiles(values: number[]): Percentiles {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted.length ? sorted[sorted.length - 1] : null,
    available: true,
    caveat:
      "responseTimeMs is wall-clock on the Playwright path for rendered pages (PLAN-03 M4) — the http.ttfbMs / render.wallMs namespace split has not shipped in this run's stored records.",
  };
}

function histogram(counts: Record<string, number>): Histogram {
  return { buckets: Object.entries(counts).map(([key, count]) => ({ key, count })), available: true };
}

export interface Measurements {
  runId: string;
  generatedAt: string;
  overview: {
    discovered: number;
    unique: number;
    allowed: number;
    attempted: number;
    successful: number;
    failed: number;
    blockedByRobots: number;
    coveragePercent: number;
    durationMs: number;
    pagesPerMinute: number;
    maxDepthSeen: number | null;
  };
  statusHistogram: Histogram;
  depthHistogram: Histogram;
  responseTimeMs: Percentiles;
  wordCount: {
    avg: number | null;
    median: number | null;
    thinContentUnder300: number;
    available: true;
  };
  pageWeight: Unavailable;
  bytesDownloaded: Unavailable;
  indexability: {
    indexable: number;
    noindex: number;
    blockedByRobots: number;
    nonOkStatus: number;
    available: true;
  };
  renderStats: {
    http: number;
    playwright: number;
    renderRatePercent: number;
    available: true;
  };
  linksAndOrphans: {
    internalLinks: number;
    externalLinks: number;
    orphanCandidates: number;
    available: true;
  };
  sitemapCoverage: {
    urlsInSitemap: number;
    inSitemapNotCrawled: number;
    crawledNotInSitemap: number;
    sitemapEntriesFailed: number;
    available: true;
  };
  failuresByClass: Histogram;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

export async function buildMeasurements(runId: string): Promise<Measurements | null> {
  const [pages, { report, blocked, failures }] = await Promise.all([getPages(runId), getRun(runId)]);
  if (!report) return null;

  const r: CrawlSummary = report;
  const times = pages.map((p: CrawledPageWithId) => p.performance.responseTimeMs).filter((t): t is number => t !== null);
  const words = pages.map((p: CrawledPageWithId) => p.content.wordCount).filter((w): w is number => w !== null);
  const depthCounts: Record<string, number> = {};
  for (const p of pages) {
    const key = p.crawl.depth === null || p.crawl.depth === undefined ? "unknown" : String(p.crawl.depth);
    depthCounts[key] = (depthCounts[key] ?? 0) + 1;
  }

  const indexable = pages.filter((p) => p.statusCode !== null && p.statusCode < 300 && !p.robots.noindex).length;
  const noindex = pages.filter((p) => p.robots.noindex).length;
  const nonOk = pages.filter((p) => p.statusCode === null || p.statusCode >= 300).length;
  const httpCount = pages.filter((p) => p.renderedWith === "http").length;
  const pwCount = pages.filter((p) => p.renderedWith === "playwright").length;

  const failuresByClass: Record<string, number> = { ...r.failuresByClass };
  void failures; // failures.json rows are already summarized into failuresByClass on report.json; kept for future per-row surfacing

  const durationMinutes = r.durationMs > 0 ? r.durationMs / 60000 : 0;

  return {
    runId,
    generatedAt: new Date().toISOString(),
    overview: {
      discovered: r.discovered,
      unique: r.unique,
      allowed: r.allowed,
      attempted: r.attempted,
      successful: r.successful,
      failed: r.failed,
      blockedByRobots: r.blockedByRobots,
      coveragePercent: r.coveragePercent,
      durationMs: r.durationMs,
      pagesPerMinute: durationMinutes > 0 ? Math.round((r.successful / durationMinutes) * 10) / 10 : 0,
      maxDepthSeen: typeof r.maxDepthSeen === "number" ? r.maxDepthSeen : null,
    },
    statusHistogram: histogram(r.statusHistogram),
    depthHistogram: histogram(depthCounts),
    responseTimeMs: computePercentiles(times),
    wordCount: {
      avg: avg(words),
      median: median(words),
      thinContentUnder300: pages.filter((p) => (p.content.wordCount ?? 0) < 300).length,
      available: true,
    },
    pageWeight: { available: false, reason: "No per-page byte-weight field is stored on CrawledPage yet (awaiting crawler §8 asset/page-size instrumentation)." },
    bytesDownloaded: { available: false, reason: "report.json carries no bytes/transferSize total yet (awaiting crawler instrumentation)." },
    indexability: { indexable, noindex, blockedByRobots: blocked.length, nonOkStatus: nonOk, available: true },
    renderStats: {
      http: httpCount,
      playwright: pwCount,
      renderRatePercent: pages.length > 0 ? Math.round((pwCount / pages.length) * 1000) / 10 : 0,
      available: true,
    },
    linksAndOrphans: {
      internalLinks: r.internalLinks,
      externalLinks: r.externalLinks,
      orphanCandidates: r.orphanCandidates.length,
      available: true,
    },
    sitemapCoverage: {
      urlsInSitemap: r.sitemap.urlsInSitemap,
      inSitemapNotCrawled: r.sitemap.inSitemapNotCrawled.length,
      crawledNotInSitemap: r.sitemap.crawledNotInSitemap.length,
      sitemapEntriesFailed: r.sitemap.sitemapEntriesFailed.length,
      available: true,
    },
    failuresByClass: histogram(failuresByClass),
  };
}
