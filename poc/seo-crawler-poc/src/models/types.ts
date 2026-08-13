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

/**
 * Auth step 2 — drive a real browser through a login form, for sites where pasting a session
 * cookie isn't practical. The session then belongs to the Playwright context for the whole crawl.
 */
export interface FormLoginConfig {
  loginUrl: string;
  usernameSelector: string;
  passwordSelector: string;
  submitSelector: string;
  username: string;
  password: string;
  /** Must be present after submit for the login to count as successful; null = skip the check. */
  successSelector: string | null;
}

/** Credentials for crawling protected routes. Never persisted into run evidence. */
export interface CrawlAuth {
  /** Browser-driven form login (step 2). Mutually usable with the header forms below. */
  formLogin?: FormLoginConfig | null;
  /** HTTP Basic — becomes an Authorization header on every request (staging sites). */
  basic: { username: string; password: string } | null;
  /** Raw Cookie header value, e.g. "session=abc; csrf=xyz" (log in manually, paste the cookie). */
  cookie: string | null;
  /** Extra request headers — API tokens, WAF bypass tokens. */
  headers: Record<string, string>;
}

/**
 * Guard rails for authenticated crawls. A logged-in crawler follows every link it finds, which
 * inside a member area includes /logout (kills its own session) and destructive GET endpoints.
 * Defaults are asymmetric on purpose: ON when credentials are present, OFF otherwise — on an
 * anonymous crawl "/how-to-cancel-a-subscription" is just an article, and skipping it would
 * silently cost coverage.
 */
export interface CrawlSafety {
  /** Never fetch URLs whose path matches these (case-insensitive substrings). */
  excludePatterns: string[];
  /** Skip logout-ish paths so the crawler can't end its own session mid-run. */
  denyLogout: boolean;
  /** Skip destructive-looking GET endpoints (delete/remove/cancel/…). */
  denyDestructive: boolean;
}

/** A URL deliberately not fetched — recorded as evidence, never silently dropped. */
export interface SkippedUrlRecord {
  url: string;
  reason: "logout" | "destructive" | "user-excluded";
  matchedPattern: string;
  /** Page the link was found on. */
  foundOn: string | null;
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
  /** Credentials for protected routes; null = anonymous crawl. */
  auth?: CrawlAuth | null;
  /** Guard rails; defaults derived from whether auth is present (see CrawlSafety). */
  safety?: CrawlSafety;
  /** Let fonts load in the browser pass. Off by default — fonts are the single heaviest
   * blocked resource class, so only pay for them when font extraction actually runs. */
  loadFonts?: boolean;
  /** Capture a thumb+full screenshot per page. Off by default; forces pages that would
   * otherwise be static-only onto the Playwright pass, since a screenshot needs a browser. */
  screenshots?: boolean;
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
  /* The booleans above cannot tell a JS-deindexed page from a JS "fix" Google never renders —
   * opposite directions, opposite fixes. Optional: older runs only stored the booleans. */
  staticCanonical?: string | null;
  renderedCanonical?: string | null;
  staticNoindex?: boolean;
  renderedNoindex?: boolean;
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
  /** How the content area was located — provenance, so a rule can tell "no main content"
   * from "we fell back to body". v3-optional. */
  contentAreaMethod?: "main" | "article" | "role-main" | "body-minus-chrome";
  /** Words inside [aria-hidden="true"]. Counted in `text` (Google indexes them) but tracked
   * separately because they're hidden from assistive tech — an a11y finding, not an SEO one. */
  ariaHiddenWordCount?: number;
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

/* ── v3 extraction contract (extraction-completeness R&D §6). All additive + optional. ── */

/** Where the <head> effectively ended. Per HTML tree construction ANY invalid element
 * (div, img, noscript>img …) implicitly closes head, and Google "stops reading any further
 * elements" — so a canonical after that point is present in source but invisible to Google. */
export interface HeadBoundary {
  elementCount: number;
  /** Tag name of the element that implicitly closed head; null when head closed properly. */
  closedBy: string | null;
  closedAtOffset: number | null;
  /** Signals found after the effective head end. `honoured` is PER SIGNAL — Google ignores a
   * body canonical but explicitly respects a body meta robots. Never collapse to one verdict. */
  stranded: { signal: string; tag: string; honoured: boolean }[];
}

export interface CharsetInfo {
  value: string | null;
  source: "bom" | "header" | "meta" | null;
  /** Byte offset of <meta charset>. Must serialize within the first 1024 bytes to take effect. */
  metaOffset: number | null;
  effective: boolean;
}

/** <base href> silently rewrites every relative canonical/hreflang/icon/preload on the page.
 * All but the first are ignored per spec; OG tags do not respect it at all. */
export interface BaseHrefInfo {
  href: string | null;
  count: number;
}

export interface MetaTagRecord {
  /** twitter:* is valid on BOTH name and property — key on the token, record the attribute. */
  attr: "name" | "property" | "http-equiv" | "itemprop" | "charset";
  key: string;
  value: string;
  /** Document order. Load-bearing: OG structured sub-properties bind to the preceding root. */
  index: number;
  inHead: boolean;
}

export interface OgImageRecord {
  url: string;
  secureUrl?: string;
  type?: string;
  width?: number;
  height?: number;
  alt?: string;
}

/** Ordered-stream model. A flat {property → value} map is incorrect by construction for OG. */
export interface HeadMetaReport {
  tags: MetaTagRecord[];
  /** OG conflict rule: FIRST occurrence wins. */
  og: Record<string, string>;
  /** Twitter conflict rule: LAST occurrence wins (X's documented behaviour — inverted from OG). */
  twitter: Record<string, string>;
  ogImages: OgImageRecord[];
  viewport: string | null;
  /** viewport with user-scalable=no / maximum-scale<2 — a WCAG 1.4.4 failure. */
  viewportBlocksZoom: boolean;
  themeColor: string | null;
  colorScheme: string | null;
  referrer: string | null;
  generator: string | null;
  /** Site-verification tokens keyed by provider (google, bing, pinterest, facebook …). */
  verification: Record<string, string>;
}

export interface IconRecord {
  rel: string;
  href: string;
  declaredSizes: string | null;
  type: string | null;
  index: number;
  source: "link" | "manifest" | "meta" | "implicit";
  /** Populated only when probed: HTTP status and the ACTUAL decoded pixel size. */
  status?: number | null;
  actualSize?: { width: number; height: number } | null;
}

export interface FaviconReport {
  candidates: IconRecord[];
  /** Spec rule: the LAST equally-appropriate icon declared in tree order wins, and a 404
   * candidate falls through to the next — so every candidate must be probed, not just one. */
  effective: string | null;
  /** Google SERP eligibility is a separate question from browser-tab display. */
  googleSerpEligible: boolean | null;
  googleSerpBlockers: string[];
}

export interface HeadingRecord {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  /** Document order ACROSS levels — hierarchy checks need sequence, not per-level buckets. */
  index: number;
  inMain: boolean;
}

export interface DocumentStructure {
  headings: HeadingRecord[];
  paragraphs: number;
  lists: { ordered: number; unordered: number; definition: number };
  /** th/caption presence separates a real data table from a layout table. */
  tables: { total: number; withTh: number; withCaption: number };
  codeBlocks: number;
  blockquotes: number;
  /** Landmark elements present: main, article, nav, aside, header, footer, section[aria-label]. */
  landmarks: string[];
}

export interface FontFaceRecord {
  family: string;
  source: string;
  origin: "same-origin" | "third-party";
  host: string | null;
  /** font-display graded by VALUE — Lighthouse's own audit wrongly passes `block`. */
  display: string | null;
  preloaded: boolean;
  /** preload as=font without crossorigin ⇒ guaranteed double download. Zero false positives. */
  preloadMissingCrossorigin: boolean;
}

export interface FontReport {
  faces: FontFaceRecord[];
  /** Distinct third-party hosts serving fonts — GDPR exposure, not just a perf finding. */
  thirdPartyHosts: string[];
  /** Families actually used by rendered text, when the browser pass observed them. */
  usedFamilies?: string[];
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
  /** v3 fields (extraction-completeness wave). Same "undefined ≠ empty" contract as v2 above. */
  headBoundary?: HeadBoundary;
  charset?: CharsetInfo;
  baseHref?: BaseHrefInfo;
  headMeta?: HeadMetaReport;
  favicons?: FaviconReport;
  structure?: DocumentStructure;
  fonts?: FontReport;
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
  /** --screenshots evidence. undefined = flag off (or pre-screenshot run); null = flag on but
   * capture failed for this page; object = success, paths relative to the run dir. */
  screenshot?: { thumb: string; full: string; capturedAt: string } | null;
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

/** ---------- Tier 2: link graph, similarity, crawl diffing ---------- */

export interface PageGraphScore {
  pageId: string;
  url: string;
  /** Internal PageRank scaled to 1-100 on a log curve (the Ahrefs Page Rating model). */
  internalRank: number;
  /** Raw PageRank probability before scaling — kept so the maths stays auditable. */
  rawRank: number;
  inlinks: number;
  uniqueInlinks: number;
  outlinks: number;
  depth: number;
}

export interface GraphReport {
  runId: string;
  generatedAt: string;
  dampingFactor: number;
  iterations: number;
  converged: boolean;
  pages: PageGraphScore[];
  /** Crawled pages with zero internal inlinks (seed excluded). */
  orphans: string[];
}

export interface SimilarityCluster {
  /** Lowest pairwise similarity within the cluster — the conservative figure to report. */
  similarity: number;
  members: { pageId: string; url: string; wordCount: number }[];
}

export interface SimilarityReport {
  runId: string;
  generatedAt: string;
  /** Jaccard threshold a pair must meet to cluster. */
  threshold: number;
  /** Word n-gram size used for shingling. */
  shingleSize: number;
  clusters: SimilarityCluster[];
}

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
  /** Issue lifecycle when both runs have been analyzed; null otherwise. */
  issues: { newIssues: string[]; fixedIssues: string[]; persistingCount: number } | null;
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
