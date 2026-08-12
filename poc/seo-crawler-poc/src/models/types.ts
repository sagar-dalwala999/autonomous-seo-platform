/** Shared contract for all slices (spec.md foundation). Changes go through Main Claude only. */

export interface CrawlScope {
  /** Registrable domain (eTLD+1) via tldts, e.g. "example.com". www/non-www both in scope. */
  registrableDomain: string;
  /** For hosts without a registrable domain (localhost, IPs): exact hostname[:port] match. */
  fallbackHost: string | null;
  /**
   * Extra hostnames treated as this site (staging-domain crawls, e.g. the target-site fixtures'
   * "summittrailgear.example" while serving on localhost:3105). URLs on these hosts are in-scope
   * and remapped onto seedOrigin for queue identity; evidence keeps the authored URL.
   */
  hostAliases: string[];
  seedOrigin: string;
  seedUrl: string;
}

export interface CrawlOptions {
  startUrl: string;
  maxPages: number;
  concurrency: number;
  respectRobots: boolean;
  render: "auto" | "never" | "always";
  outDir: string;
  runId: string;
  userAgent: string;
  /** Max requests/sec against the target host (politeness). */
  maxRequestsPerSecond: number;
  /** --alias host[,host...] — see CrawlScope.hostAliases. */
  hostAliases: string[];
  /** --max-depth N — max link-hops from the start URL; null = unlimited. */
  maxDepth: number | null;
}

export interface Redirect {
  from: string;
  to: string;
  statusCode: number;
}

export interface LinkRecord {
  /** Final URL of the page the link was found on. */
  source: string;
  /** Resolved absolute href AS AUTHORED (preserves http://, www-mix, etc. — evidence). */
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
  /** null = alt attribute missing entirely; "" = present but empty. The distinction is evidence. */
  alt: string | null;
  width: number | null;
  height: number | null;
  /** Lowercased extension-derived format ("jpg", "png", "bmp", "webp", ...), null if none. */
  format: string | null;
}

export interface VideoRecord {
  /** Resolved absolute media/embed URL. */
  url: string;
  kind: "file" | "youtube" | "vimeo" | "iframe";
  /** Resolved poster attr when present. */
  poster: string | null;
  /** MIME type attr when present (file kind). */
  mimeType: string | null;
  /** Provider video id for youtube/vimeo, else null. */
  providerId: string | null;
}

/** v2 (POC-2 wave): raw og / twitter meta values (property → content) in document order. */
export interface SocialTags {
  og: Record<string, string>;
  twitter: Record<string, string>;
}

export interface HreflangEntry {
  lang: string;
  /** Resolved absolute. */
  href: string;
}

export interface MetaRefresh {
  delaySeconds: number | null;
  url: string | null;
  raw: string;
}

/** SERP pixel widths are ESTIMATES from a char-width table, not a browser measurement. */
export interface PixelWidths {
  titlePx: number | null;
  metaDescriptionPx: number | null;
}

export interface PageStats {
  htmlBytes: number;
  /** visible text bytes / htmlBytes, 0..1. */
  textRatio: number;
  domNodes: number;
  contentEncoding: string | null;
  httpVersion: string | null;
}

/** Raw-vs-rendered divergence when a page was escalated to Chromium. */
export interface RenderDivergence {
  titleChanged: boolean;
  metaDescriptionChanged: boolean;
  canonicalChanged: boolean;
  noindexChanged: boolean;
  linkCountDelta: number;
  wordCountDelta: number;
  /** Static HTML kept as raw/<pageId>.static.html. */
  staticRawSaved: boolean;
}

/** mailto:/tel: links — excluded from links[] by design, captured here as contact evidence. */
export interface ContactRecord {
  kind: "email" | "phone";
  /** The address/number with the scheme + query stripped, e.g. "hi@example.com". */
  value: string;
  /** href as authored. */
  href: string;
  anchor: string;
}

export interface ExternalCheckResult {
  url: string;
  statusCode: number | null;
  error: string | null;
  /** Page the link was found on (finalUrl). */
  checkedFrom: string;
}

export interface StructuredDataRecord {
  type: "application/ld+json";
  raw: string;
  parsed: unknown | null;
  parseError: string | null;
}

export interface RobotsMeta {
  /** Raw values from <meta name="robots"> (+ googlebot variants) AND X-Robots-Tag headers. */
  meta: string[];
  noindex: boolean;
  nofollow: boolean;
}

export interface PageContent {
  text: string;
  wordCount: number;
  /** sha256 hex of whitespace-normalized lowercased text — near-duplicate evidence. */
  contentHash: string;
}

export interface CrawlMeta {
  depth: number;
  parentUrl: string | null;
  /** "seed" | "html-link" | "sitemap" — merged, deduped, insertion order. */
  discoverySources: string[];
}

/** What the fetch layer hands to extraction — pure data, no crawler types. */
export interface FetchArtifact {
  html: string;
  /** Normalized queue identity of the request. */
  url: string;
  /** URL that actually served the content (after redirects). */
  finalUrl: string;
  statusCode: number;
  /** Lowercased header names. Kept subset incl. content-encoding + security headers (v2). */
  headers: Record<string, string>;
  responseTimeMs: number | null;
  /** "1.1" | "2.0" etc. when observable; null otherwise (v2). */
  httpVersion?: string | null;
}

export interface ExtractionResult {
  /** First instance (back-compat); ALL instances in titles[]. */
  title: string | null;
  metaDescription: string | null;
  /** Every <title> in document order (multiple = an SEO issue). v2-optional, see below. */
  titles?: string[];
  /** Every meta description in document order. v2-optional, see below. */
  metaDescriptions?: string[];
  /** Resolved absolute; null when no canonical present. */
  canonical: string | null;
  robots: RobotsMeta;
  headings: { h1: string[]; h2: string[]; h3: string[] };
  links: LinkRecord[];
  images: ImageRecord[];
  videos: VideoRecord[];
  structuredData: StructuredDataRecord[];
  content: PageContent;
  /**
   * v2 fields (POC-2 wave). OPTIONAL because ~50 pre-v2 stored runs lack them — readers MUST
   * treat `undefined` as "not captured" (rule skips as data-unavailable; UI shows honest empty
   * state) and never conflate it with an empty capture. New writes always populate them.
   */
  social?: SocialTags;
  contacts?: ContactRecord[];
  hreflang?: HreflangEntry[];
  metaRefresh?: MetaRefresh | null;
  metaKeywords?: string | null;
  pixelWidths?: PixelWidths;
  pageStats?: PageStats;
}

export interface CrawledPage extends ExtractionResult {
  runId: string;
  url: string;
  normalizedUrl: string;
  finalUrl: string | null;
  statusCode: number | null;
  redirectChain: Redirect[];
  headers: Record<string, string>;
  performance: { responseTimeMs: number | null };
  renderedWith: "http" | "playwright";
  /** Why JS escalation fired; [] when renderedWith === "http". */
  renderSignals: string[];
  /** Raw-vs-rendered diff; null when never escalated; undefined on pre-v2 records. */
  renderDivergence?: RenderDivergence | null;
  fetchedAt: string;
  crawl: CrawlMeta;
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

/** Serializable robots evidence (RobotsInfo minus the matcher function). */
export interface RobotsEvidence {
  url: string;
  statusCode: number | null;
  content: string | null;
  sitemaps: string[];
  parseStatus: "ok" | "empty" | "unavailable" | "error";
  fetchedAt: string;
}

export interface RobotsInfo extends RobotsEvidence {
  isAllowed(url: string, userAgent?: string): boolean;
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

/** ---------- POC-2 analysis contract (brief §6b, D-08: deterministic rulebook) ---------- */

export type IssueSeverity = "error" | "warning" | "notice";

export interface IssueEvidence {
  /** Dot-path into the stored record (e.g. "robots.noindex", "images[2].alt"). */
  field: string;
  value: unknown;
  /** Set when evidence lives on a different page than the issue's primary URL. */
  pageId?: string;
}

export interface Issue {
  ruleId: string;
  category: string;
  severity: IssueSeverity;
  scope: "page" | "site";
  /** Primary URL; null for pure site-scope findings. */
  url: string | null;
  pageId: string | null;
  message: string;
  howToFix: string;
  evidence: IssueEvidence[];
  /** Human-readable applied threshold, e.g. "title < 30 chars (was 7)". */
  threshold?: string;
}

export interface RuleMeta {
  id: string;
  category: string;
  defaultSeverity: IssueSeverity;
  description: string;
  howToFix: string;
  /** Record fields the rule needs; absent field on old runs → rule skips, never false-fires. */
  dataRequirements: string[];
}

export interface AnalysisReport {
  runId: string;
  generatedAt: string;
  rulebookVersion: string;
  configSnapshot: unknown;
  /** Pages without error-severity issues ÷ analyzed pages × 100, one decimal. */
  healthScore: number;
  pagesAnalyzed: number;
  counts: Record<IssueSeverity, number>;
  rulesRun: number;
  rulesSkippedDataUnavailable: string[];
  issues: Issue[];
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
  /** Pages whose fetch traversed >= 1 redirect hop. */
  redirects: number;
  statusHistogram: Record<string, number>;
  jsRendered: number;
  internalLinks: number;
  externalLinks: number;
  /** Crawled pages with zero internal inlinks, seed excluded. */
  orphanCandidates: string[];
  /** successful / attempted * 100, one decimal. */
  coveragePercent: number;
  /** Deepest crawl.depth among stored pages (0 when none). */
  maxDepthSeen: number;
  sitemap: {
    urlsInSitemap: number;
    inSitemapNotCrawled: string[];
    crawledNotInSitemap: string[];
    sitemapEntriesFailed: string[];
  };
  failuresByClass: Record<string, number>;
}
