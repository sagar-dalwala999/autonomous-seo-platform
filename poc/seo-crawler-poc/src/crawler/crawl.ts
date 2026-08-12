/** Slice S4 implements. */
import { Configuration, CheerioCrawler, PlaywrightCrawler, RequestQueue } from "crawlee";
import { chromium } from "playwright";
import type { Request as PlaywrightRequest } from "playwright";
import type {
  CrawlAuth,
  CrawlOptions,
  CrawlSummary,
  CrawlScope,
  CrawlSafety,
  CrawledPage,
  ExternalCheckResult,
  ExtractionResult,
  FailureClass,
  FailureRecord,
  Redirect,
  RenderDivergence,
  RobotsInfo,
  SkippedUrlRecord,
} from "../models/types";
import { normalizeUrl } from "../url/normalize";
import { deriveScope, isInScope, remapAliasedUrl } from "../url/scope";
import { extractPage } from "../extraction/index";
import { fetchRobots } from "../discovery/robots";
import { discoverSitemaps } from "../discovery/sitemap";
import { needsJsRendering } from "../detection/needsJsRendering";
import { RunStore } from "../storage/runStore";
import { buildSummary } from "../report/summary";
import { authHeaders, checkSafety, defaultSafety } from "./safety";
import { performFormLogin, cookiesToHeader } from "./formLogin";

const KEPT_HEADERS = [
  "content-type",
  "x-robots-tag",
  "content-length",
  "last-modified",
  "content-encoding",
  "strict-transport-security",
  "content-security-policy",
  "x-frame-options",
  "x-content-type-options",
  "referrer-policy",
] as const;
const MAX_URL_LENGTH = 2000;
const MAX_QUERY_PARAMS = 10;
const MAX_REDIRECT_HOPS = 8;
const REQUEST_HANDLER_TIMEOUT_SECS = 30;
const MAX_REQUEST_RETRIES = 2;
/** Adaptive settle budget before the rendered snapshot — portfolio-style SPAs can take 6-10s
 * (intro loaders) to mount, verified live on sagardalwala.me; SSR pages stabilize in ~2s. */
const RENDER_SETTLE_MAX_MS = 15000;
const RENDER_SETTLE_TICK_MS = 1000;
const EXTERNAL_CHECK_CAP = 50;
const EXTERNAL_CHECK_RPS = 2;
const EXTERNAL_CHECK_TIMEOUT_MS = 10_000;

/**
 * Auth step 2 (C1): runs the browser-driven login ONCE, before the crawl loop, and folds the
 * resulting session cookie into a CrawlAuth so it rides B2's existing authHeaders()/defaultSafety()
 * path unchanged — that single Cookie header then reaches BOTH the CheerioCrawler pass (request
 * headers) and the Playwright escalation pass (setExtraHTTPHeaders), so neither fetch layer is
 * left anonymous. Throws on failure — a half-anonymous authenticated crawl is worse than none, so
 * the caller must abort rather than fall through with effectiveAuth unchanged.
 */
async function resolveEffectiveAuth(auth: CrawlAuth | null): Promise<CrawlAuth | null> {
  if (!auth?.formLogin) return auth;

  const loginBrowser = await chromium.launch();
  try {
    const loginContext = await loginBrowser.newContext();
    const result = await performFormLogin(auth.formLogin, loginContext);
    if (!result.ok) {
      throw new Error(`Form login failed at ${auth.formLogin.loginUrl}, aborting crawl (no anonymous fallback): ${result.error ?? "unknown reason"}`);
    }
    const sessionCookie = cookiesToHeader(result.cookies);
    console.log(`[auth] form login OK at ${auth.formLogin.loginUrl} — session cookie captured for both fetch passes`);
    return { ...auth, cookie: auth.cookie ? `${auth.cookie}; ${sessionCookie}` : sessionCookie };
  } finally {
    await loginBrowser.close();
  }
}

interface DiscoveryEntry {
  depth: number;
  parentUrl: string | null;
  sources: Set<string>;
}

type SeedRequest = { url: string; uniqueKey: string; headers?: Record<string, string> };

/**
 * A URL flagged for Playwright re-fetch. `staticHtml`/`staticExtraction` carry the static pass's
 * own capture so the Playwright handler can diff raw-vs-rendered without re-reading from disk —
 * present for real JS-detection escalations and 403/429 retry-in-browser (both have a real static
 * body); null for pure network-failure retries (timeout/DNS never got a response to diff against).
 */
interface EscalationCandidate {
  signals: string[];
  staticHtml: string | null;
  staticExtraction: ExtractionResult | null;
}

/**
 * The whole crawl: robots → sitemap discovery → seed queue → static-first Crawlee crawl with
 * JS-detection escalation to Playwright → storage → summary. Returns the built summary
 * (already persisted via RunStore.saveReport).
 *
 * `checkExternal` (A2, `--check-external`) is a second param rather than a CrawlOptions field —
 * models/types.ts is do_not_touch for this slice, and threading it through the CLI only touches
 * files this slice owns.
 */
export async function runCrawl(options: CrawlOptions, checkExternal = false): Promise<CrawlSummary> {
  const startedAt = new Date();

  const normalizedStart = normalizeUrl(options.startUrl);
  if (!normalizedStart) {
    throw new Error(`Invalid start URL: ${options.startUrl}`);
  }
  const scope = deriveScope(normalizedStart, options.hostAliases);

  // C1: resolve the form-login session (if configured) BEFORE creating any run evidence — a
  // failed login must leave no partial run directory behind.
  const effectiveAuth = await resolveEffectiveAuth(options.auth ?? null);

  const store = new RunStore(options.outDir, options.runId);
  await store.init();

  // Auth + safety (B2). authHdrs is the single source of truth for "is auth configured" —
  // it's {} whenever CrawlAuth carries nothing, so hasAuth needs no separate presence check.
  // effectiveAuth carries the form-login session cookie merged in (C1) alongside any static
  // basic/cookie/header auth, so both B2 helpers see the full picture unchanged.
  const authHdrs = authHeaders(effectiveAuth);
  const hasAuth = Object.keys(authHdrs).length > 0;
  const safety: CrawlSafety = options.safety ?? defaultSafety(effectiveAuth);
  /** Dedup by URL — a guarded path (e.g. /logout) is typically linked from every member page. */
  const skippedByUrl = new Map<string, SkippedUrlRecord>();
  function makeSeedRequest(url: string): SeedRequest {
    return hasAuth ? { url, uniqueKey: url, headers: authHdrs } : { url, uniqueKey: url };
  }

  // Session-loss detection (basic — full detection is a later step): warn once if an
  // authenticated crawl gets a 401/403 after at least one page already succeeded.
  let sawAuthSuccess = false;
  let sessionLossWarned = false;
  function noteAuthResponse(url: string, statusCode: number | null): void {
    if (!hasAuth || statusCode === null) return;
    if ((statusCode === 401 || statusCode === 403) && sawAuthSuccess && !sessionLossWarned) {
      sessionLossWarned = true;
      console.warn(`[auth] session may have expired at ${url} — later pages may be anonymous`);
    } else if (statusCode >= 200 && statusCode < 400) {
      sawAuthSuccess = true;
    }
  }

  const discovery = new Map<string, DiscoveryEntry>();
  const blocked = new Set<string>();
  const processedUrls = new Set<string>();
  const failures: FailureRecord[] = [];
  let discoveredCount = 0;

  // Chromium fallback for failed fetches (403/429/timeout/network): the failure is parked, the
  // URL rides the escalation pass, and the parked record is written only if Chromium never got
  // to it — Chromium's own outcome (page or failure) wins otherwise.
  const heldFailures = new Map<string, FailureRecord>();
  const pwOutcomes = new Set<string>();
  async function flushHeldFailures(): Promise<void> {
    for (const [url, failure] of heldFailures) {
      if (!pwOutcomes.has(url)) await recordFailure(failure);
    }
    heldFailures.clear();
  }

  // Always fetched for evidence + sitemap declarations; --no-robots only turns off enforcement.
  const robots: RobotsInfo = await fetchRobots(scope.seedOrigin, options.userAgent);
  const { isAllowed: _isAllowed, ...robotsEvidence } = robots;
  await store.saveRobots(robotsEvidence);

  // Plan-review round 2: robots.txt declares sitemap URLs on the aliased host (e.g.
  // summittrailgear.example) which never resolves while crawling localhost — remap before fetch.
  const remappedRobotsForSitemap: RobotsInfo = {
    ...robots,
    sitemaps: robots.sitemaps.map((s) => remapAliasedUrl(s, scope)),
  };
  const sitemap = await discoverSitemaps(remappedRobotsForSitemap, scope.seedOrigin);
  await store.saveSitemaps(sitemap);

  function exceedsUrlCaps(url: string): boolean {
    if (url.length > MAX_URL_LENGTH) return true;
    try {
      return Array.from(new URL(url).searchParams.keys()).length > MAX_QUERY_PARAMS;
    } catch {
      return false;
    }
  }

  /**
   * Single gate for every discovery path (seed/sitemap/html-link/rendered-DOM link): enforces the
   * URL caps, scope, and robots, then merges into the shared discovery map. Returns true only the
   * first time a URL clears every gate — callers use that to decide whether to actually enqueue.
   */
  function considerUrl(
    normalizedUrl: string,
    depth: number,
    parentUrl: string | null,
    source: string,
    applyRobots: boolean,
  ): boolean {
    if (exceedsUrlCaps(normalizedUrl)) {
      discoveredCount++;
      console.warn(`[skip] URL exceeds length/query-param cap: ${normalizedUrl.slice(0, 100)}`);
      return false;
    }
    if (!isInScope(normalizedUrl, scope)) return false;
    discoveredCount++;

    // Discovered but beyond the operator's link-hop budget — never enters the frontier.
    if (options.maxDepth !== null && depth > options.maxDepth) return false;

    if (applyRobots && options.respectRobots && !robots.isAllowed(normalizedUrl, options.userAgent)) {
      blocked.add(normalizedUrl);
      return false;
    }

    // Guard rails (B2): a skipped URL is recorded as evidence, never enqueued, and never
    // counted as a failure — its own bucket, mirroring the robots-blocked handling above.
    const skip = checkSafety(normalizedUrl, parentUrl, safety);
    if (skip) {
      if (!skippedByUrl.has(normalizedUrl)) skippedByUrl.set(normalizedUrl, skip);
      return false;
    }

    const existing = discovery.get(normalizedUrl);
    if (existing) {
      existing.sources.add(source);
      return false;
    }
    discovery.set(normalizedUrl, { depth, parentUrl, sources: new Set([source]) });
    return true;
  }

  // Seed: the operator's explicit start URL always crawls — robots gate applies to discovered
  // links, not the URL the operator directly asked for.
  discovery.set(normalizedStart, { depth: 0, parentUrl: null, sources: new Set(["seed"]) });
  discoveredCount++;
  const initialSeed: SeedRequest[] = [makeSeedRequest(normalizedStart)];

  for (const entry of sitemap.entries) {
    const remapped = remapAliasedUrl(entry.url, scope);
    const normalized = normalizeUrl(remapped);
    if (!normalized) continue;
    if (considerUrl(normalized, 1, null, "sitemap", true)) {
      initialSeed.push(makeSeedRequest(normalized));
    }
  }

  function pickHeaders(raw: Record<string, string | string[] | undefined> | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    if (!raw) return out;
    for (const key of KEPT_HEADERS) {
      const v = raw[key];
      if (typeof v === "string") out[key] = v;
      else if (Array.isArray(v) && v.length > 0) out[key] = v.join(", ");
    }
    return out;
  }

  /** Crawlee raises anti-bot blocks as thrown errors ("Request blocked - received 429 status
   * code") — pull the real status back out so 429/403 don't vanish into "other". */
  function blockedStatusFrom(error: Error): number | null {
    const m = /received (\d{3}) status code/i.exec(error.message ?? "");
    return m && m[1] ? Number(m[1]) : null;
  }

  function classifyError(error: Error): FailureClass {
    const name = error.name ?? "";
    const code = (error as NodeJS.ErrnoException).code ?? "";
    const msg = error.message ?? "";
    const blockedStatus = blockedStatusFrom(error);
    if (blockedStatus !== null) return blockedStatus >= 500 ? "http-5xx" : "http-4xx";
    if (name === "TimeoutError" || /timeout/i.test(msg)) return "timeout";
    if (code === "ENOTFOUND" || code === "EAI_AGAIN" || /getaddrinfo/i.test(msg)) return "dns";
    if (name === "MaxRedirectsError" || code === "ERR_TOO_MANY_REDIRECTS" || /too many redirects/i.test(msg)) {
      return "redirect-loop";
    }
    if (/parse|cheerio|invalid html/i.test(msg)) return "parse-error";
    return "other";
  }

  /** Exponential per-request backoff before Crawlee retries a rate-limited (429) fetch —
   * hammering a host that just told us to slow down converts retries into guaranteed failures. */
  async function backoffOnRateLimit(request: { userData: Record<string, unknown> }, error: Error): Promise<void> {
    if (blockedStatusFrom(error) !== 429) return;
    const attempt = typeof request.userData.__rateLimited === "number" ? request.userData.__rateLimited + 1 : 1;
    request.userData.__rateLimited = attempt;
    await new Promise((r) => setTimeout(r, Math.min(3000 * 2 ** (attempt - 1), 15000)));
  }

  function buildCrawledPage(params: {
    normalizedUrl: string;
    finalUrl: string | null;
    statusCode: number | null;
    headers: Record<string, string>;
    responseTimeMs: number | null;
    extraction: ExtractionResult;
    redirectChain: Redirect[];
    renderedWith: "http" | "playwright";
    renderSignals: string[];
    renderDivergence?: RenderDivergence | null;
  }): CrawledPage {
    const meta = discovery.get(params.normalizedUrl);
    return {
      ...params.extraction,
      // null = never escalated or no static baseline to diff; set by the PW pass otherwise.
      renderDivergence: params.renderDivergence ?? null,
      runId: options.runId,
      url: params.normalizedUrl,
      normalizedUrl: params.normalizedUrl,
      finalUrl: params.finalUrl,
      statusCode: params.statusCode,
      redirectChain: params.redirectChain,
      headers: params.headers,
      performance: { responseTimeMs: params.responseTimeMs },
      renderedWith: params.renderedWith,
      renderSignals: params.renderSignals,
      fetchedAt: new Date().toISOString(),
      crawl: {
        depth: meta?.depth ?? 0,
        parentUrl: meta?.parentUrl ?? null,
        discoverySources: meta ? Array.from(meta.sources) : [],
      },
    };
  }

  async function recordFailure(failure: FailureRecord): Promise<void> {
    failures.push(failure);
    await store.saveFailure(failure);
  }

  /**
   * got/Cheerio only exposes the URLs a redirect traversed (response.redirectUrls), not per-hop
   * status. Real per-hop codes require a manual redirect:'manual' walk; on any hop failure the
   * sentinel 0 marks "not observed" rather than fabricating a plausible-looking 3xx.
   */
  async function traceCheerioRedirects(originalUrl: string, redirectUrls: string[]): Promise<Redirect[]> {
    if (redirectUrls.length === 0) return [];
    const hops = [originalUrl, ...redirectUrls];
    const chain: Redirect[] = [];
    for (let i = 0; i < hops.length - 1 && i < MAX_REDIRECT_HOPS; i++) {
      const from = hops[i]!;
      const to = hops[i + 1]!;
      let statusCode = 0;
      try {
        const res = await fetch(from, {
          method: "GET",
          redirect: "manual",
          headers: { "user-agent": options.userAgent },
          signal: AbortSignal.timeout(5000),
        });
        statusCode = res.status;
      } catch {
        statusCode = 0;
      }
      chain.push({ from, to, statusCode });
    }
    return chain;
  }

  /** Raw-vs-rendered diff for an escalated page. Called only once the static snapshot has been
   * saved via saveStaticRaw, so staticRawSaved is always true here. */
  function computeRenderDivergence(staticExtraction: ExtractionResult, renderedExtraction: ExtractionResult): RenderDivergence {
    return {
      titleChanged: staticExtraction.title !== renderedExtraction.title,
      metaDescriptionChanged: staticExtraction.metaDescription !== renderedExtraction.metaDescription,
      canonicalChanged: staticExtraction.canonical !== renderedExtraction.canonical,
      noindexChanged: staticExtraction.robots.noindex !== renderedExtraction.robots.noindex,
      linkCountDelta: renderedExtraction.links.length - staticExtraction.links.length,
      wordCountDelta: renderedExtraction.content.wordCount - staticExtraction.content.wordCount,
      staticRawSaved: true,
    };
  }

  /** Playwright natively tracks each redirect hop's real response — no extra fetch needed. */
  async function tracePlaywrightRedirects(finalRequest: PlaywrightRequest): Promise<Redirect[]> {
    const hops: { url: string; status: number | null }[] = [];
    let req: PlaywrightRequest | null = finalRequest;
    while (req) {
      const res = await req.response().catch(() => null);
      hops.unshift({ url: req.url(), status: res ? res.status() : null });
      req = req.redirectedFrom();
    }
    const chain: Redirect[] = [];
    for (let i = 0; i < hops.length - 1; i++) {
      chain.push({ from: hops[i]!.url, to: hops[i + 1]!.url, statusCode: hops[i]!.status ?? 0 });
    }
    return chain;
  }

  const crawleeConfig = new Configuration({ persistStorage: false });

  // Each pass needs its OWN queue: the default RequestQueue is shared across crawler instances
  // in-process, so an escalation URL already "handled" by the Cheerio pass would be silently
  // dropped by the Playwright pass (live bug: quotes-js jsRendered=0 with 1 candidate).
  let queueSeq = 0;
  async function freshQueue(): Promise<RequestQueue> {
    return RequestQueue.open(`${options.runId}-pass-${queueSeq++}`, { config: crawleeConfig });
  }

  /** Static-first pass. When toRenderCollector is given (render:"auto"), escalation candidates are
   * queued into it instead of fetched inline — the Playwright pass runs after this one finishes. */
  async function runCheerioPass(
    seed: SeedRequest[],
    budget: number,
    toRenderCollector: Map<string, EscalationCandidate> | null,
  ): Promise<void> {
    if (seed.length === 0 || budget <= 0) return;

    const crawler = new CheerioCrawler(
      {
        requestQueue: await freshQueue(),
        maxRequestsPerCrawl: budget,
        maxConcurrency: options.concurrency,
        maxRequestsPerMinute: Math.max(1, Math.round(options.maxRequestsPerSecond * 60)),
        requestHandlerTimeoutSecs: REQUEST_HANDLER_TIMEOUT_SECS,
        maxRequestRetries: MAX_REQUEST_RETRIES,
        errorHandler: async ({ request }, error) => backoffOnRateLimit(request, error as Error),

        async requestHandler({ request, response, body }) {
          const normalizedUrl = request.uniqueKey;
          // got typing allows statusCode to be undefined mid-stream; 0 = "not observed" sentinel.
          const statusCode = response.statusCode ?? 0;
          const headers = pickHeaders(response.headers);
          const contentType = headers["content-type"] ?? "";
          noteAuthResponse(normalizedUrl, statusCode);

          if (contentType && !contentType.includes("html")) {
            await recordFailure({
              url: normalizedUrl,
              normalizedUrl,
              reason: "other",
              statusCode,
              attempts: request.retryCount + 1,
              error: `non-HTML content-type: ${contentType}`,
              depth: discovery.get(normalizedUrl)?.depth ?? null,
              parentUrl: discovery.get(normalizedUrl)?.parentUrl ?? null,
            });
            processedUrls.add(normalizedUrl);
            return;
          }

          const html = typeof body === "string" ? body : String(body);
          const httpVersion = response.httpVersion || null;
          const extraction = extractPage(
            { html, url: normalizedUrl, finalUrl: request.loadedUrl ?? normalizedUrl, statusCode, headers, responseTimeMs: null, httpVersion },
            scope,
          );

          // Hard 4xx/5xx shells (Next.js 404s are tiny + bundle-heavy) match the CSR-shell shape
          // but re-rendering an error page cannot enrich evidence — only 2xx pages escalate.
          if (toRenderCollector && options.render === "auto" && statusCode < 400) {
            const decision = needsJsRendering(html, extraction, scope);
            if (decision.needed) {
              toRenderCollector.set(normalizedUrl, { signals: decision.signals, staticHtml: html, staticExtraction: extraction });
            }
          }

          const redirectChain = await traceCheerioRedirects(normalizedUrl, response.redirectUrls ?? []);
          const page = buildCrawledPage({
            normalizedUrl,
            finalUrl: request.loadedUrl ?? null,
            statusCode,
            headers,
            responseTimeMs: response.timings?.phases?.total ?? null,
            extraction,
            redirectChain,
            renderedWith: "http",
            renderSignals: [],
          });

          await store.saveRaw(normalizedUrl, html);
          await store.savePage(page);
          processedUrls.add(normalizedUrl);

          if (statusCode >= 400) {
            const failure: FailureRecord = {
              url: normalizedUrl,
              normalizedUrl,
              reason: statusCode >= 500 ? "http-5xx" : "http-4xx",
              statusCode,
              attempts: request.retryCount + 1,
              error: null,
              depth: discovery.get(normalizedUrl)?.depth ?? null,
              parentUrl: discovery.get(normalizedUrl)?.parentUrl ?? null,
            };
            // 403/429 are usually anti-bot answers, not content — retry in Chromium first. The
            // static body was still captured, so it's a real baseline for renderDivergence too.
            if (toRenderCollector && options.render === "auto" && (statusCode === 403 || statusCode === 429)) {
              heldFailures.set(normalizedUrl, failure);
              toRenderCollector.set(normalizedUrl, {
                signals: [`fetch-retry:http-${statusCode}`],
                staticHtml: html,
                staticExtraction: extraction,
              });
            } else {
              await recordFailure(failure);
            }
          }

          const parentDepth = discovery.get(normalizedUrl)?.depth ?? 0;
          const toEnqueue: SeedRequest[] = [];
          for (const link of extraction.links) {
            if (!link.targetNormalized) continue;
            const remapped = remapAliasedUrl(link.targetNormalized, scope);
            if (considerUrl(remapped, parentDepth + 1, request.loadedUrl ?? normalizedUrl, "html-link", true)) {
              toEnqueue.push(makeSeedRequest(remapped));
            }
          }
          if (toEnqueue.length > 0 && processedUrls.size < options.maxPages) {
            await crawler.addRequests(toEnqueue);
          }
        },

        failedRequestHandler({ request }, error) {
          const normalizedUrl = request.uniqueKey;
          const meta = discovery.get(normalizedUrl);
          const blockedStatus = blockedStatusFrom(error as Error);
          noteAuthResponse(normalizedUrl, blockedStatus);
          const failure: FailureRecord = {
            url: normalizedUrl,
            normalizedUrl,
            reason: classifyError(error as Error),
            statusCode: blockedStatus,
            attempts: request.retryCount + 1,
            error: error instanceof Error ? error.message : String(error),
            depth: meta?.depth ?? null,
            parentUrl: meta?.parentUrl ?? null,
          };
          // Timeouts/opaque network errors and 403/429 blocks may be transport-level anti-bot —
          // Chromium retry. DNS and redirect-loops won't improve in a browser; record those now.
          const retryable =
            failure.reason === "timeout" || failure.reason === "other" || blockedStatus === 403 || blockedStatus === 429;
          if (toRenderCollector && options.render === "auto" && retryable) {
            heldFailures.set(normalizedUrl, failure);
            // No response ever arrived (timeout/DNS/opaque network error) — nothing to diff against.
            toRenderCollector.set(normalizedUrl, {
              signals: [`fetch-retry:${blockedStatus !== null ? `http-${blockedStatus}` : failure.reason}`],
              staticHtml: null,
              staticExtraction: null,
            });
          } else {
            void recordFailure(failure);
          }
          processedUrls.add(normalizedUrl);
        },
      },
      crawleeConfig,
    );

    await crawler.run(seed);
  }

  /** render:"auto" escalation pass — re-fetches only the URLs the Cheerio pass flagged, replaces
   * their stored record, and hands newly-found rendered-DOM links to the caller (not self-enqueued —
   * they re-enter the static crawler on the next loop iteration per the plan). */
  async function runPlaywrightEscalationPass(
    toRender: Map<string, EscalationCandidate>,
    budget: number,
    nextBatchCollector: SeedRequest[],
  ): Promise<void> {
    if (toRender.size === 0 || budget <= 0) return;
    const seed: SeedRequest[] = Array.from(toRender.keys()).map((url) => ({ url, uniqueKey: url }));
    await runPlaywrightPass(seed, budget, { selfEnqueue: false, nextBatchCollector, signalsForUrl: toRender });
  }

  /** render:"always" — every page is fetched via Playwright directly and self-enqueues its own
   * newly-found links (no alternating cheerio/playwright passes, there is no static pass at all). */
  async function runPlaywrightOnlyPass(seed: SeedRequest[], budget: number): Promise<void> {
    await runPlaywrightPass(seed, budget, { selfEnqueue: true });
  }

  async function runPlaywrightPass(
    seed: SeedRequest[],
    budget: number,
    opts: { selfEnqueue: boolean; nextBatchCollector?: SeedRequest[]; signalsForUrl?: Map<string, EscalationCandidate> },
  ): Promise<void> {
    if (seed.length === 0 || budget <= 0) return;

    const crawler = new PlaywrightCrawler(
      {
        requestQueue: await freshQueue(),
        maxRequestsPerCrawl: budget,
        maxConcurrency: options.concurrency,
        maxRequestsPerMinute: Math.max(1, Math.round(options.maxRequestsPerSecond * 60)),
        requestHandlerTimeoutSecs: REQUEST_HANDLER_TIMEOUT_SECS,
        maxRequestRetries: MAX_REQUEST_RETRIES,
        errorHandler: async ({ request }, error) => backoffOnRateLimit(request, error as Error),
        preNavigationHooks: [
          async ({ page, request }) => {
            request.userData.__navStart = Date.now();
            // Browser navigation ignores Request.headers entirely (confirmed against crawlee's
            // browser-crawler internals) — setExtraHTTPHeaders is the only way in for a real
            // page load. Used for Basic/Cookie/custom alike: a single header applies the same
            // regardless of which aliased host (scope.hostAliases) is being fetched, unlike
            // context.addCookies which is domain-scoped and would need per-alias duplication.
            if (hasAuth) await page.setExtraHTTPHeaders(authHdrs);
            await page.route("**/*", (route) => {
              const type = route.request().resourceType();
              if (type === "image" || type === "font" || type === "media") return route.abort();
              return route.continue();
            });
          },
        ],

        async requestHandler({ request, page, response }) {
          const normalizedUrl = request.uniqueKey;
          // Adaptive settle (found via sagardalwala.me: intro-loader SPAs mount 6-10s AFTER
          // `load`; a fixed wait either burns time on SSR pages or misses slow mounts). Poll a
          // cheap DOM-size metric until it's stable for 2 ticks (4 when still empty — genuinely
          // blank pages exit early), capped by budget. Bottom-scroll first so
          // IntersectionObserver lazy-loaders fire; back to top before capture.
          await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
          {
            const settleStart = Date.now();
            let last = -1;
            let stableTicks = 0;
            while (Date.now() - settleStart < RENDER_SETTLE_MAX_MS) {
              await page.waitForTimeout(RENDER_SETTLE_TICK_MS);
              const size = await page
                .evaluate(() => document.body.innerText.length + document.querySelectorAll("a,img").length * 10)
                .catch(() => -1);
              if (size === last) {
                stableTicks++;
                if (size > 0 && stableTicks >= 2) break;
                if (size === 0 && stableTicks >= 4) break;
              } else {
                stableTicks = 0;
                // Fresh content appeared — re-trigger lazy-loaders below the new fold.
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
              }
              last = size;
            }
          }
          await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
          const html = await page.content();
          const finalUrl = page.url();
          const statusCode = response ? response.status() : null;
          noteAuthResponse(normalizedUrl, statusCode);
          const headers = pickHeaders(response ? response.headers() : undefined);
          const responseTimeMs = Date.now() - (typeof request.userData.__navStart === "number" ? request.userData.__navStart : Date.now());
          // Best-effort: Playwright doesn't always expose this (e.g. cached/service-worker responses).
          const httpVersion = response ? await response.httpVersion().catch(() => null) : null;

          const extraction = extractPage(
            { html, url: normalizedUrl, finalUrl, statusCode: statusCode ?? 0, headers, responseTimeMs, httpVersion },
            scope,
          );

          const redirectChain = response ? await tracePlaywrightRedirects(response.request()) : [];
          const candidate = opts.signalsForUrl?.get(normalizedUrl);
          const signals = candidate?.signals ?? ["forced:always"];

          // Preserve the static snapshot BEFORE this pass's saveRaw/savePage below overwrite it.
          let renderDivergence: RenderDivergence | null = null;
          if (candidate?.staticHtml !== undefined && candidate.staticHtml !== null && candidate.staticExtraction) {
            await store.saveStaticRaw(normalizedUrl, candidate.staticHtml);
            renderDivergence = computeRenderDivergence(candidate.staticExtraction, extraction);
          }

          const page_ = buildCrawledPage({
            normalizedUrl,
            finalUrl,
            statusCode,
            headers,
            responseTimeMs,
            extraction,
            redirectChain,
            renderedWith: "playwright",
            renderSignals: signals,
            renderDivergence,
          });

          await store.saveRaw(normalizedUrl, html);
          await store.savePage(page_);
          processedUrls.add(normalizedUrl);
          pwOutcomes.add(normalizedUrl);

          if (statusCode !== null && statusCode >= 400) {
            await recordFailure({
              url: normalizedUrl,
              normalizedUrl,
              reason: statusCode >= 500 ? "http-5xx" : "http-4xx",
              statusCode,
              attempts: request.retryCount + 1,
              error: null,
              depth: discovery.get(normalizedUrl)?.depth ?? null,
              parentUrl: discovery.get(normalizedUrl)?.parentUrl ?? null,
            });
          }

          const parentDepth = discovery.get(normalizedUrl)?.depth ?? 0;
          const found: SeedRequest[] = [];
          for (const link of extraction.links) {
            if (!link.targetNormalized) continue;
            const remapped = remapAliasedUrl(link.targetNormalized, scope);
            if (considerUrl(remapped, parentDepth + 1, finalUrl, "html-link", true)) {
              found.push({ url: remapped, uniqueKey: remapped });
            }
          }
          if (found.length > 0 && processedUrls.size < options.maxPages) {
            if (opts.selfEnqueue) {
              await crawler.addRequests(found);
            } else {
              opts.nextBatchCollector?.push(...found);
            }
          }
        },

        failedRequestHandler({ request }, error) {
          const normalizedUrl = request.uniqueKey;
          const meta = discovery.get(normalizedUrl);
          pwOutcomes.add(normalizedUrl);
          const blockedStatus = blockedStatusFrom(error as Error);
          noteAuthResponse(normalizedUrl, blockedStatus);
          void recordFailure({
            url: normalizedUrl,
            normalizedUrl,
            reason: classifyError(error as Error),
            statusCode: blockedStatus,
            attempts: request.retryCount + 1,
            error: error instanceof Error ? error.message : String(error),
            depth: meta?.depth ?? null,
            parentUrl: meta?.parentUrl ?? null,
          });
          processedUrls.add(normalizedUrl);
        },
      },
      crawleeConfig,
    );

    await crawler.run(seed);
  }

  if (options.render === "never") {
    await runCheerioPass(initialSeed, options.maxPages, null);
  } else if (options.render === "always") {
    await runPlaywrightOnlyPass(initialSeed, options.maxPages);
  } else {
    // auto: alternate static pass ↔ escalation pass until the frontier is empty or budget runs out.
    let pendingSeed = initialSeed;
    while (pendingSeed.length > 0 && processedUrls.size < options.maxPages) {
      const toRenderThisPass = new Map<string, EscalationCandidate>();
      await runCheerioPass(pendingSeed, options.maxPages - processedUrls.size, toRenderThisPass);
      pendingSeed = [];

      if (toRenderThisPass.size > 0) {
        const nextBatch: SeedRequest[] = [];
        // Re-renders replace already-counted records, so they are budget-neutral — a static pass
        // that exhausts maxPages must not starve escalation (live bug: quotes-js jsRendered=0).
        // Only NEW links from the rendered DOM stay budget-gated via the loop condition.
        await runPlaywrightEscalationPass(toRenderThisPass, toRenderThisPass.size, nextBatch);
        pendingSeed = processedUrls.size < options.maxPages ? nextBatch : [];
      }
      await flushHeldFailures();
    }
    await flushHeldFailures();
  }

  await store.saveBlocked(Array.from(blocked));
  await store.saveSkipped(Array.from(skippedByUrl.values()));

  const pages = await store.loadAllPages();
  const finishedAt = new Date();
  const summary = buildSummary({
    pages,
    failures,
    blocked: Array.from(blocked),
    sitemap,
    discoveredCount,
    startedAt,
    finishedAt,
    options,
  });
  await store.saveReport(summary);

  if (checkExternal) {
    await runExternalLinkChecks(pages, store);
  }

  return summary;
}

/** `--check-external`: HEAD-check up to EXTERNAL_CHECK_CAP unique external link targets found in
 * the stored pages, sequentially at EXTERNAL_CHECK_RPS — politeness toward hosts we don't own. */
async function runExternalLinkChecks(pages: CrawledPage[], store: RunStore): Promise<void> {
  const targets = new Map<string, string>();
  outer: for (const page of pages) {
    for (const link of page.links) {
      if (link.type !== "external") continue;
      if (targets.has(link.target)) continue;
      targets.set(link.target, page.finalUrl ?? page.normalizedUrl);
      if (targets.size >= EXTERNAL_CHECK_CAP) break outer;
    }
  }

  const results: ExternalCheckResult[] = [];
  const delayMs = Math.ceil(1000 / EXTERNAL_CHECK_RPS);
  for (const [url, checkedFrom] of targets) {
    results.push(await headCheckExternal(url, checkedFrom));
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  await store.saveExternalChecks(results);
}

async function headCheckExternal(url: string, checkedFrom: string): Promise<ExternalCheckResult> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(EXTERNAL_CHECK_TIMEOUT_MS),
    });
    return { url, statusCode: res.status, error: null, checkedFrom };
  } catch (err) {
    return { url, statusCode: null, error: err instanceof Error ? err.message : String(err), checkedFrom };
  }
}
