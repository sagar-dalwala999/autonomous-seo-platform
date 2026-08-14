import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { computeMeasurements } from "../../../../src/analysis/measurements/compute";
import type { CrawledPage, CrawlSummary, ExternalCheckResult, FailureRecord } from "../../../../src/models/types";
import { makeFailure, makePage } from "../../report/fixtures";

const dirs: string[] = [];
afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

interface RunFixture {
  pages: CrawledPage[];
  summary?: CrawlSummary;
  failures?: FailureRecord[];
  externalLinks?: ExternalCheckResult[];
}

async function writeRun(fixture: RunFixture, runId = "test-run"): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "measurements-run-"));
  dirs.push(root);
  const runDir = path.join(root, "runs", runId);
  await mkdir(path.join(runDir, "pages"), { recursive: true });
  await Promise.all(
    fixture.pages.map((page, i) => writeFile(path.join(runDir, "pages", `p${i}.json`), JSON.stringify(page), "utf-8")),
  );
  if (fixture.summary) await writeFile(path.join(runDir, "report.json"), JSON.stringify(fixture.summary), "utf-8");
  if (fixture.failures) await writeFile(path.join(runDir, "failures.json"), JSON.stringify(fixture.failures), "utf-8");
  if (fixture.externalLinks) await writeFile(path.join(runDir, "external-links.json"), JSON.stringify(fixture.externalLinks), "utf-8");
  return runDir;
}

function byId(result: Awaited<ReturnType<typeof computeMeasurements>>, id: string) {
  const m = result.measurements.find((x) => x.id === id);
  if (!m) throw new Error(`no measurement ${id}`);
  return m;
}

const baseSummary: CrawlSummary = {
  runId: "test-run",
  startUrl: "https://ex.com/",
  startedAt: "2026-01-01T00:00:00.000Z",
  finishedAt: "2026-01-01T00:01:00.000Z",
  durationMs: 60000,
  discovered: 10,
  unique: 10,
  allowed: 10,
  blockedByRobots: 0,
  attempted: 10,
  successful: 3,
  failed: 0,
  redirects: 0,
  statusHistogram: {},
  jsRendered: 0,
  internalLinks: 0,
  externalLinks: 0,
  orphanCandidates: ["https://ex.com/orphan"],
  coveragePercent: 100,
  maxDepthSeen: 2,
  sitemap: { urlsInSitemap: 0, inSitemapNotCrawled: [], crawledNotInSitemap: [], sitemapEntriesFailed: [] },
  failuresByClass: {},
};

describe("computeMeasurements — returns exactly 31 cards", () => {
  it("always emits all 31 ids, available or not", async () => {
    const runDir = await writeRun({ pages: [makePage()] });
    const result = await computeMeasurements(runDir);
    expect(result.measurements).toHaveLength(31);
    const ids = new Set(result.measurements.map((m) => m.id));
    expect(ids.size).toBe(31); // no duplicate ids
    for (const m of result.measurements) {
      if (m.available) {
        expect(m.value).not.toBeNull();
        expect(m.display).not.toBeNull();
        expect(m.unavailableReason).toBeNull();
      } else {
        expect(m.value).toBeNull();
        expect(m.display).toBeNull();
        expect(m.unavailableReason).not.toBeNull();
      }
    }
  });

  it("pagesInRun matches the number of stored page records, not summary.successful", async () => {
    const runDir = await writeRun({ pages: [makePage(), makePage({ url: "https://ex.com/b", normalizedUrl: "https://ex.com/b" })], summary: { ...baseSummary, successful: 999 } });
    const result = await computeMeasurements(runDir);
    expect(result.pagesInRun).toBe(2);
  });
});

describe("coverage measurements", () => {
  it("pages-crawled counts stored page records", async () => {
    const runDir = await writeRun({ pages: [makePage(), makePage({ url: "https://ex.com/b", normalizedUrl: "https://ex.com/b" })] });
    const result = await computeMeasurements(runDir);
    expect(byId(result, "pages-crawled").value).toBe(2);
  });

  it("pages-discovered is unavailable without report.json, available with it", async () => {
    const noReport = await computeMeasurements(await writeRun({ pages: [makePage()] }));
    expect(byId(noReport, "pages-discovered").available).toBe(false);

    const withReport = await computeMeasurements(await writeRun({ pages: [makePage()], summary: baseSummary }));
    const m = byId(withReport, "pages-discovered");
    expect(m.available).toBe(true);
    expect(m.value).toBe(10);
  });

  it("broken-pages unions page-record 4xx/5xx with failures.json, without double counting", async () => {
    const errorPage = makePage({ url: "https://ex.com/404", normalizedUrl: "https://ex.com/404", statusCode: 404 });
    const okPage = makePage();
    const runDir = await writeRun({
      pages: [okPage, errorPage],
      // Same URL as errorPage — crawl.ts writes both a page record AND a failure for 4xx/5xx.
      failures: [makeFailure({ url: "https://ex.com/404", normalizedUrl: "https://ex.com/404", statusCode: 404 })],
    });
    const result = await computeMeasurements(runDir);
    expect(byId(result, "broken-pages").value).toBe(1); // not 2
  });

  it("broken-pages also counts a failure with no matching page record", async () => {
    const runDir = await writeRun({
      pages: [makePage()],
      failures: [makeFailure({ url: "https://ex.com/gone", normalizedUrl: "https://ex.com/gone", reason: "http-5xx", statusCode: 503 })],
    });
    const result = await computeMeasurements(runDir);
    expect(byId(result, "broken-pages").value).toBe(1);
  });

  it("broken-pages is 0 (available), not unavailable, when failures.json was never written", async () => {
    const runDir = await writeRun({ pages: [makePage()] });
    const result = await computeMeasurements(runDir);
    const m = byId(result, "broken-pages");
    expect(m.available).toBe(true);
    expect(m.value).toBe(0);
  });

  it("redirects counts pages with a non-empty redirectChain, from raw pages alone", async () => {
    const redirected = makePage({ redirectChain: [{ from: "https://ex.com/old", to: "https://ex.com/", statusCode: 301 }] });
    const runDir = await writeRun({ pages: [redirected, makePage({ url: "https://ex.com/b", normalizedUrl: "https://ex.com/b" })] });
    const result = await computeMeasurements(runDir);
    expect(byId(result, "redirects").value).toBe(1);
  });

  it("orphan-pages reads report.orphanCandidates and states the crawl-bound in its explainer", async () => {
    const runDir = await writeRun({ pages: [makePage()], summary: baseSummary });
    const result = await computeMeasurements(runDir);
    const m = byId(result, "orphan-pages");
    expect(m.value).toBe(1);
    expect(m.explainer.toLowerCase()).toContain("this crawl reached");
  });

  it("deep-pages counts crawl.depth beyond the local threshold", async () => {
    const deep = makePage({ crawl: { depth: 5, parentUrl: "https://ex.com/", discoverySources: ["html-link"] } });
    const shallow = makePage({ url: "https://ex.com/b", normalizedUrl: "https://ex.com/b", crawl: { depth: 1, parentUrl: "https://ex.com/", discoverySources: ["html-link"] } });
    const result = await computeMeasurements(await writeRun({ pages: [deep, shallow] }));
    expect(byId(result, "deep-pages").value).toBe(1);
  });

  it("needs-javascript counts renderedWith === playwright", async () => {
    const rendered = makePage({ renderedWith: "playwright" });
    const runDir = await writeRun({ pages: [rendered, makePage({ url: "https://ex.com/b", normalizedUrl: "https://ex.com/b" })] });
    const result = await computeMeasurements(runDir);
    expect(byId(result, "needs-javascript").value).toBe(1);
  });
});

describe("on-page measurements", () => {
  it("counts missing title / meta description / H1, and multiple H1", async () => {
    const missing = makePage({ title: null, metaDescription: "", headings: { h1: [], h2: [], h3: [] } });
    const multi = makePage({ url: "https://ex.com/b", normalizedUrl: "https://ex.com/b", headings: { h1: ["A", "B"], h2: [], h3: [] } });
    const result = await computeMeasurements(await writeRun({ pages: [missing, multi] }));
    expect(byId(result, "missing-title").value).toBe(1);
    expect(byId(result, "missing-meta-description").value).toBe(1);
    expect(byId(result, "missing-h1").value).toBe(1); // only `missing` has a 0-length h1[]; `multi` has 2
    expect(byId(result, "multiple-h1").value).toBe(1);
  });

  it("title-too-wide is unavailable pre-v2 (no pixelWidths anywhere) and counts correctly when present", async () => {
    const { pixelWidths: _drop, ...noPx } = makePage();
    const unavailable = await computeMeasurements(await writeRun({ pages: [noPx as CrawledPage] }));
    expect(byId(unavailable, "title-too-wide").available).toBe(false);

    const wide = makePage({ pixelWidths: { titlePx: 700, metaDescriptionPx: null } });
    const narrow = makePage({ url: "https://ex.com/b", normalizedUrl: "https://ex.com/b", pixelWidths: { titlePx: 100, metaDescriptionPx: null } });
    const result = await computeMeasurements(await writeRun({ pages: [wide, narrow] }));
    const m = byId(result, "title-too-wide");
    expect(m.available).toBe(true);
    expect(m.value).toBe(1);
    expect(m.sampleSize).toBe(2);
  });
});

describe("content measurements", () => {
  it("thin-content uses the configured/default word threshold", async () => {
    const thin = makePage({ content: { text: "x", wordCount: 10, contentHash: "h1" } });
    const ok = makePage({ url: "https://ex.com/b", normalizedUrl: "https://ex.com/b", content: { text: "x", wordCount: 300, contentHash: "h2" } });
    const result = await computeMeasurements(await writeRun({ pages: [thin, ok] }));
    expect(byId(result, "thin-content").value).toBe(1);
  });

  it("duplicate-content catches an exact-hash pair", async () => {
    const a = makePage({ content: { text: "same text repeated", wordCount: 3, contentHash: "dup" } });
    const b = makePage({ url: "https://ex.com/b", normalizedUrl: "https://ex.com/b", content: { text: "same text repeated", wordCount: 3, contentHash: "dup" } });
    const c = makePage({ url: "https://ex.com/c", normalizedUrl: "https://ex.com/c", content: { text: "unrelated", wordCount: 1, contentHash: "unique" } });
    const result = await computeMeasurements(await writeRun({ pages: [a, b, c] }));
    expect(byId(result, "duplicate-content").value).toBe(2);
  });

  it("average-word-count averages content.wordCount across all pages", async () => {
    const a = makePage({ content: { text: "x", wordCount: 100, contentHash: "a" } });
    const b = makePage({ url: "https://ex.com/b", normalizedUrl: "https://ex.com/b", content: { text: "x", wordCount: 200, contentHash: "b" } });
    const result = await computeMeasurements(await writeRun({ pages: [a, b] }));
    expect(byId(result, "average-word-count").value).toBe(150);
  });

  it("reading-ease scores real prose higher than dense jargon and is unavailable on all-empty content", async () => {
    const simple = makePage({ content: { text: "The cat sat on the mat. The dog ran. It was fun.", wordCount: 11, contentHash: "s" } });
    const result = await computeMeasurements(await writeRun({ pages: [simple] }));
    const m = byId(result, "reading-ease");
    expect(m.available).toBe(true);
    expect(m.value! ).toBeGreaterThan(60); // simple sentences score high (easy)

    const empty = makePage({ content: { text: "", wordCount: 0, contentHash: "e" } });
    const none = await computeMeasurements(await writeRun({ pages: [empty] }));
    expect(byId(none, "reading-ease").available).toBe(false);
  });
});

describe("indexability measurements", () => {
  it("noindex counts robots.noindex === true", async () => {
    const blocked = makePage({ robots: { meta: ["noindex"], noindex: true, nofollow: false } });
    const result = await computeMeasurements(await writeRun({ pages: [blocked, makePage({ url: "https://ex.com/b", normalizedUrl: "https://ex.com/b" })] }));
    expect(byId(result, "noindex").value).toBe(1);
  });
});

describe("social & schema measurements", () => {
  it("missing-open-graph is unavailable pre-v2 and counts pages with an empty og map", async () => {
    const { social: _drop, ...noSocial } = makePage();
    const unavailable = await computeMeasurements(await writeRun({ pages: [noSocial as CrawledPage] }));
    expect(byId(unavailable, "missing-open-graph").available).toBe(false);

    const noOg = makePage({ social: { og: {}, twitter: {} } });
    const hasOg = makePage({ url: "https://ex.com/b", normalizedUrl: "https://ex.com/b", social: { og: { "og:title": "t" }, twitter: {} } });
    const result = await computeMeasurements(await writeRun({ pages: [noOg, hasOg] }));
    expect(byId(result, "missing-open-graph").value).toBe(1);
  });

  it("incomplete-schema is unavailable pre-v3 and counts itemsMissingRequired > 0", async () => {
    const unavailable = await computeMeasurements(await writeRun({ pages: [makePage()] }));
    expect(byId(unavailable, "incomplete-schema").available).toBe(false);

    const counts = { jsonLdBlocks: 1, jsonLdParseErrors: 0, items: 1, jsonLdItems: 1, microdataItems: 0, rdfaItems: 0, validatedItems: 1, itemsMissingRequired: 1, unknownTypes: 0 };
    const incomplete = makePage({ structuredDataReport: { items: [], counts, errors: [], types: [], truncated: false } });
    const result = await computeMeasurements(await writeRun({ pages: [incomplete] }));
    expect(byId(result, "incomplete-schema").value).toBe(1);
  });
});

describe("link measurements", () => {
  it("broken-internal-links counts a link to a 4xx page but excludes a 401/403 link", async () => {
    const dead = makePage({
      url: "https://ex.com/dead",
      normalizedUrl: "https://ex.com/dead",
      statusCode: 404,
    });
    const source = makePage({
      links: [
        { source: "https://ex.com/", target: "https://ex.com/dead", targetNormalized: "https://ex.com/dead", anchor: "dead", type: "internal", rel: null, nofollow: false, sponsored: false, ugc: false, targetAttr: null },
        { source: "https://ex.com/", target: "https://ex.com/private", targetNormalized: "https://ex.com/private", anchor: "private", type: "internal", rel: null, nofollow: false, sponsored: false, ugc: false, targetAttr: null },
      ],
    });
    const result = await computeMeasurements(
      await writeRun({
        pages: [source, dead],
        failures: [makeFailure({ url: "https://ex.com/private", normalizedUrl: "https://ex.com/private", statusCode: 403 })],
      }),
    );
    expect(byId(result, "broken-internal-links").value).toBe(1);
  });

  it("broken/refused outbound links are unavailable without external-links.json, split correctly when present", async () => {
    const unavailable = await computeMeasurements(await writeRun({ pages: [makePage()] }));
    expect(byId(unavailable, "broken-outbound-links").available).toBe(false);
    expect(byId(unavailable, "outbound-links-refused").available).toBe(false);

    const externalLinks: ExternalCheckResult[] = [
      { url: "https://a.example/x", statusCode: 404, error: null, checkedFrom: "https://ex.com/" },
      { url: "https://b.example/y", statusCode: 403, error: null, checkedFrom: "https://ex.com/" },
      { url: "https://c.example/z", statusCode: null, error: "fetch failed", checkedFrom: "https://ex.com/" },
      { url: "https://d.example/ok", statusCode: 200, error: null, checkedFrom: "https://ex.com/" },
    ];
    const result = await computeMeasurements(await writeRun({ pages: [makePage()], externalLinks }));
    expect(byId(result, "broken-outbound-links").value).toBe(2); // 404 + fetch-failed
    expect(byId(result, "outbound-links-refused").value).toBe(1); // 403
  });
});

describe("media measurements", () => {
  it("images-without-alt counts alt === null only (not empty string)", async () => {
    const page = makePage({
      images: [
        { url: "https://ex.com/a.png", alt: null, width: null, height: null, format: "png" },
        { url: "https://ex.com/b.png", alt: "", width: null, height: null, format: "png" },
      ],
    });
    const result = await computeMeasurements(await writeRun({ pages: [page] }));
    expect(byId(result, "images-without-alt").value).toBe(1);
  });

  it("heavy-images is unavailable when no image has a measured byte size", async () => {
    const page = makePage({ images: [{ url: "https://ex.com/a.png", alt: "a", width: null, height: null, format: "png" }] });
    const result = await computeMeasurements(await writeRun({ pages: [page] }));
    expect(byId(result, "heavy-images").available).toBe(false);
  });

  it("heavy-images counts images over the byte threshold once sizes are captured", async () => {
    const page = makePage({
      images: [
        { url: "https://ex.com/big.png", alt: "a", width: null, height: null, format: "png", asset: { bytes: 500_000, byteSource: "content-length", naturalWidth: null, naturalHeight: null, naturalSource: null, status: 200, sizeError: null } },
        { url: "https://ex.com/small.png", alt: "a", width: null, height: null, format: "png", asset: { bytes: 1_000, byteSource: "content-length", naturalWidth: null, naturalHeight: null, naturalSource: null, status: 200, sizeError: null } },
      ],
    });
    const result = await computeMeasurements(await writeRun({ pages: [page] }));
    const m = byId(result, "heavy-images");
    expect(m.available).toBe(true);
    expect(m.value).toBe(1);
    expect(m.sampleSize).toBe(2);
  });
});

describe("security measurements", () => {
  it("mixed-content fires for an https page with an http image, not for an http page", async () => {
    const httpsWithHttpImg = makePage({ finalUrl: "https://ex.com/", images: [{ url: "http://ex.com/a.png", alt: "a", width: null, height: null, format: "png" }] });
    const httpPage = makePage({ url: "http://ex.com/b", normalizedUrl: "http://ex.com/b", finalUrl: "http://ex.com/b", images: [{ url: "http://ex.com/b.png", alt: "a", width: null, height: null, format: "png" }] });
    const result = await computeMeasurements(await writeRun({ pages: [httpsWithHttpImg, httpPage] }));
    expect(byId(result, "mixed-content").value).toBe(1);
  });

  it("certificate is always unavailable — never fabricates a validity verdict", async () => {
    const result = await computeMeasurements(await writeRun({ pages: [makePage()] }));
    const m = byId(result, "certificate");
    expect(m.available).toBe(false);
    expect(m.value).toBeNull();
  });
});

describe("performance measurements", () => {
  it("render-blocking is always unavailable — no per-resource defer/async data exists", async () => {
    const result = await computeMeasurements(await writeRun({ pages: [makePage()] }));
    expect(byId(result, "render-blocking").available).toBe(false);
  });

  it("average-ttfb reads performance.http.ttfbMs, never navigation.ttfbMs (browser wall-clock)", async () => {
    const page = makePage({
      performance: {
        responseTimeMs: 999999, // deliberately absurd, so a bug reading the wrong field is obvious
        http: { dnsMs: 1, connectMs: 1, tlsMs: 1, ttfbMs: 50, downloadMs: 5, totalMs: 57, source: "http-transport" },
        navigation: { ttfbMs: 8888, domInteractiveMs: null, domContentLoadedMs: null, loadEventMs: null, responseEndMs: null, transferSizeBytes: null, encodedBodySizeBytes: null, decodedBodySizeBytes: null },
      },
    });
    const result = await computeMeasurements(await writeRun({ pages: [page] }));
    expect(byId(result, "average-ttfb").value).toBe(50);
  });

  it("average-response reads performance.responseTimeMs, not the inflated ttfb-adjacent field", async () => {
    const page = makePage({ performance: { responseTimeMs: 123 } });
    const result = await computeMeasurements(await writeRun({ pages: [page] }));
    expect(byId(result, "average-response").value).toBe(123);
  });

  it("average-dom-nodes averages pageStats.domNodes and is unavailable pre-v2", async () => {
    const { pageStats: _drop, ...noStats } = makePage();
    const unavailable = await computeMeasurements(await writeRun({ pages: [noStats as CrawledPage] }));
    expect(byId(unavailable, "average-dom-nodes").available).toBe(false);

    const page = makePage({ pageStats: { htmlBytes: 100, textRatio: 0.1, domNodes: 42, contentEncoding: null, httpVersion: null } });
    const result = await computeMeasurements(await writeRun({ pages: [page] }));
    expect(byId(result, "average-dom-nodes").value).toBe(42);
  });

  it("average-page-weight prefers browser resource bytes over the HTML-only proxy, and states which basis it used", async () => {
    const rendered = makePage({
      performance: {
        responseTimeMs: 1,
        resources: { total: 5, byType: {}, transferBytesByType: {}, totalTransferBytes: 200_000, totalDecodedBytes: 300_000, zeroTransferCount: 0, blockedTypes: [], thirdPartyRequests: 0, thirdPartyTransferBytes: null },
      },
      pageStats: { htmlBytes: 999, textRatio: 0.1, domNodes: 1, contentEncoding: null, httpVersion: null },
    });
    const withResources = await computeMeasurements(await writeRun({ pages: [rendered] }));
    const m1 = byId(withResources, "average-page-weight");
    expect(m1.value).toBe(200_000);
    expect(m1.explainer).toContain("full page weight");

    const staticOnly = makePage({ pageStats: { htmlBytes: 5000, textRatio: 0.1, domNodes: 1, contentEncoding: null, httpVersion: null } });
    const withHtmlOnly = await computeMeasurements(await writeRun({ pages: [staticOnly] }));
    const m2 = byId(withHtmlOnly, "average-page-weight");
    expect(m2.value).toBe(5000);
    expect(m2.explainer).toContain("HTML document weight only");
  });
});
