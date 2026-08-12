/**
 * Read-side copy of the crawler's shared contract. Source of truth:
 * ../seo-crawler-poc/src/models/types.ts (owned by Main Claude / S1-S7 slices).
 * Duplicated (not imported) per spec.md S8 fallback — keeps the dashboard buildable
 * independent of the sibling project's TS project boundaries. Keep in sync manually.
 */

export interface Redirect {
  from: string;
  to: string;
  statusCode: number;
}

export interface LinkRecord {
  source: string;
  target: string;
  targetNormalized: string | null;
  anchor: string;
  type: "internal" | "external";
  rel: string | null;
  nofollow: boolean;
  sponsored: boolean;
  ugc: boolean;
  targetAttr: string | null;
}

export interface ImageRecord {
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  format: string | null;
}

export interface StructuredDataRecord {
  type: "application/ld+json";
  raw: string;
  parsed: unknown | null;
  parseError: string | null;
}

/** Additive (S13, mirrors crawler S12's src/models/types.ts VideoRecord exactly). Optional on
 *  CrawledPage so old run records without the field render fine (undefined, not []) — see
 *  MediaPanel empty state. */
export type VideoKind = "file" | "youtube" | "vimeo" | "iframe";

export interface VideoRecord {
  url: string;
  kind: VideoKind;
  poster: string | null;
  mimeType: string | null;
  providerId: string | null;
}

export interface RobotsMeta {
  meta: string[];
  noindex: boolean;
  nofollow: boolean;
}

export interface PageContent {
  text: string;
  wordCount: number;
  contentHash: string;
}

export interface CrawlMeta {
  depth: number;
  parentUrl: string | null;
  discoverySources: string[];
}

export interface CrawledPage {
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  robots: RobotsMeta;
  headings: { h1: string[]; h2: string[]; h3: string[] };
  links: LinkRecord[];
  images: ImageRecord[];
  /** Optional: absent on runs crawled before S12 shipped video extraction. */
  videos?: VideoRecord[];
  structuredData: StructuredDataRecord[];
  content: PageContent;
  runId: string;
  url: string;
  normalizedUrl: string;
  finalUrl: string | null;
  statusCode: number | null;
  redirectChain: Redirect[];
  headers: Record<string, string>;
  performance: { responseTimeMs: number | null };
  renderedWith: "http" | "playwright";
  renderSignals: string[];
  fetchedAt: string;
  crawl: CrawlMeta;
}

/** pages/<pageId>.json's filename (sans extension) is the id — not a field on CrawledPage itself. */
export interface CrawledPageWithId extends CrawledPage {
  pageId: string;
}

export type FailureClass =
  | "timeout"
  | "dns"
  | "http-4xx"
  | "http-5xx"
  | "redirect-loop"
  | "parse-error"
  | "blocked-robots"
  | "other";

export interface FailureRecord {
  url: string;
  normalizedUrl: string | null;
  reason: FailureClass;
  statusCode: number | null;
  attempts: number;
  error: string | null;
  depth: number | null;
  parentUrl: string | null;
}

export interface RobotsEvidence {
  url: string;
  statusCode: number | null;
  content: string | null;
  sitemaps: string[];
  parseStatus: "ok" | "empty" | "unavailable" | "error";
  fetchedAt: string;
}

export interface SitemapUrlEntry {
  url: string;
  sourceSitemap: string;
}

export interface SitemapFileRecord {
  url: string;
  statusCode: number | null;
  kind: "urlset" | "index" | "unknown";
  urlCount: number;
  error: string | null;
}

export interface SitemapResult {
  entries: SitemapUrlEntry[];
  files: SitemapFileRecord[];
  errors: string[];
}

export interface CrawlSummary {
  runId: string;
  startUrl: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  discovered: number;
  unique: number;
  allowed: number;
  blockedByRobots: number;
  attempted: number;
  successful: number;
  failed: number;
  redirects: number;
  statusHistogram: Record<string, number>;
  jsRendered: number;
  internalLinks: number;
  externalLinks: number;
  orphanCandidates: string[];
  coveragePercent: number;
  sitemap: {
    urlsInSitemap: number;
    inSitemapNotCrawled: string[];
    crawledNotInSitemap: string[];
    sitemapEntriesFailed: string[];
  };
  failuresByClass: Record<string, number>;
}

export interface BenchTargetEntry {
  name: string;
  external?: boolean;
  proves?: string;
  runId?: string;
  args?: string[];
  skipped: boolean;
  exitCode: number | null;
  timedOut?: boolean;
  logFile?: string | null;
  reportFile?: string | null;
  reportFound?: boolean;
  startedAt?: string;
  finishedAt?: string;
  skipReason?: string;
}

/** Shape written by scripts/bench.ts's manifest.json (source of truth: that file). */
export interface BenchManifest {
  stamp: string;
  port: number;
  targets: BenchTargetEntry[];
}

/** Additive (A5, mirrors crawler A4's src/models/types.ts "POC-2 analysis contract" exactly).
 *  Optional on the read side: runs without issues.json simply have no AnalysisReport. */
export type IssueSeverity = "error" | "warning" | "notice";

export interface IssueEvidence {
  field: string;
  value: unknown;
  pageId?: string;
}

export interface Issue {
  ruleId: string;
  category: string;
  severity: IssueSeverity;
  scope: "page" | "site";
  url: string | null;
  pageId: string | null;
  message: string;
  howToFix: string;
  evidence: IssueEvidence[];
  threshold?: string;
}

export interface AnalysisReport {
  runId: string;
  generatedAt: string;
  rulebookVersion: string;
  configSnapshot: unknown;
  healthScore: number;
  pagesAnalyzed: number;
  counts: Record<IssueSeverity, number>;
  rulesRun: number;
  rulesSkippedDataUnavailable: string[];
  issues: Issue[];
}
