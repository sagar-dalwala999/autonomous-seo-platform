import { describe, expect, it, vi } from "vitest";
import { buildSummary, printSummary } from "../../../src/report/summary";
import { makeFailure, makeLink, makeOptions, makePage } from "./fixtures";

describe("buildSummary — orphan detection", () => {
  it("flags a crawled page with zero inlinks, excludes the seed", () => {
    const seed = makePage({
      normalizedUrl: "https://ex.com/",
      crawl: { depth: 0, parentUrl: null, discoverySources: ["seed"] },
      links: [makeLink({ target: "https://ex.com/a", targetNormalized: "https://ex.com/a" })],
    });
    const pageA = makePage({
      normalizedUrl: "https://ex.com/a",
      crawl: { depth: 1, parentUrl: "https://ex.com/", discoverySources: ["html-link"] },
    });
    const pageB = makePage({
      normalizedUrl: "https://ex.com/b",
      crawl: { depth: 1, parentUrl: "https://ex.com/", discoverySources: ["sitemap"] },
    });

    const summary = buildSummary({
      pages: [seed, pageA, pageB],
      failures: [],
      blocked: [],
      sitemap: null,
      discoveredCount: 3,
      startedAt: new Date("2026-01-01T00:00:00Z"),
      finishedAt: new Date("2026-01-01T00:00:10Z"),
      options: makeOptions(),
    });

    expect(summary.orphanCandidates).toEqual(["https://ex.com/b"]);
    expect(summary.orphanCandidates).not.toContain("https://ex.com/");
  });

  it("merged discoverySources (seed + sitemap) still excludes the page from orphans", () => {
    const seed = makePage({
      normalizedUrl: "https://ex.com/",
      crawl: { depth: 0, parentUrl: null, discoverySources: ["seed", "sitemap"] },
    });
    const summary = buildSummary({
      pages: [seed],
      failures: [],
      blocked: [],
      sitemap: null,
      discoveredCount: 1,
      startedAt: new Date(),
      finishedAt: new Date(),
      options: makeOptions(),
    });
    expect(summary.orphanCandidates).toEqual([]);
  });
});

describe("buildSummary — statusHistogram", () => {
  it("buckets null status as 'none' for both pages and failures", () => {
    const nullPage = makePage({ normalizedUrl: "https://ex.com/timeout", statusCode: null });
    const dnsFailure = makeFailure({
      url: "https://ex.com/dns-fail",
      normalizedUrl: "https://ex.com/dns-fail",
      reason: "dns",
      statusCode: null,
    });
    const summary = buildSummary({
      pages: [nullPage],
      failures: [dnsFailure],
      blocked: [],
      sitemap: null,
      discoveredCount: 2,
      startedAt: new Date(),
      finishedAt: new Date(),
      options: makeOptions(),
    });
    expect(summary.statusHistogram.none).toBe(2);
  });

  it("does not double-count a URL with both a page and a failure record", () => {
    const page404 = makePage({ normalizedUrl: "https://ex.com/gone", statusCode: 404 });
    const failure = makeFailure({
      url: "https://ex.com/gone",
      normalizedUrl: "https://ex.com/gone",
      reason: "http-4xx",
      statusCode: 404,
    });
    const summary = buildSummary({
      pages: [page404],
      failures: [failure],
      blocked: [],
      sitemap: null,
      discoveredCount: 1,
      startedAt: new Date(),
      finishedAt: new Date(),
      options: makeOptions(),
    });
    expect(summary.statusHistogram["404"]).toBe(1);
    expect(summary.attempted).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.successful).toBe(0);
  });
});

describe("buildSummary — redirects", () => {
  it("counts pages with a non-empty redirectChain as redirects and as successful", () => {
    const redirected = makePage({
      normalizedUrl: "https://ex.com/new",
      statusCode: 200,
      redirectChain: [{ from: "https://ex.com/old", to: "https://ex.com/new", statusCode: 301 }],
    });
    const plain = makePage({ normalizedUrl: "https://ex.com/plain" });
    const summary = buildSummary({
      pages: [redirected, plain],
      failures: [],
      blocked: [],
      sitemap: null,
      discoveredCount: 2,
      startedAt: new Date(),
      finishedAt: new Date(),
      options: makeOptions(),
    });
    expect(summary.redirects).toBe(1);
    expect(summary.successful).toBe(2);
  });
});

describe("buildSummary — sitemap cross-reference", () => {
  it("matches an aliased-host sitemap entry to a localhost page record by path", () => {
    const page = makePage({ normalizedUrl: "http://localhost:3105/products/switchback" });
    const summary = buildSummary({
      pages: [page],
      failures: [],
      blocked: [],
      sitemap: {
        entries: [
          { url: "https://summittrailgear.example/products/switchback", sourceSitemap: "https://summittrailgear.example/sitemap.xml" },
        ],
        files: [],
        errors: [],
      },
      discoveredCount: 1,
      startedAt: new Date(),
      finishedAt: new Date(),
      options: makeOptions(),
    });
    expect(summary.sitemap.inSitemapNotCrawled).toEqual([]);
    expect(summary.sitemap.crawledNotInSitemap).toEqual([]);
    expect(summary.sitemap.urlsInSitemap).toBe(1);
  });

  it("lands a 404 sitemap entry in sitemapEntriesFailed", () => {
    const failure = makeFailure({
      url: "http://localhost:3105/guides/gear-repair",
      normalizedUrl: "http://localhost:3105/guides/gear-repair",
      reason: "http-4xx",
      statusCode: 404,
    });
    const summary = buildSummary({
      pages: [],
      failures: [failure],
      blocked: [],
      sitemap: {
        entries: [
          { url: "https://summittrailgear.example/guides/gear-repair", sourceSitemap: "https://summittrailgear.example/sitemap.xml" },
        ],
        files: [],
        errors: [],
      },
      discoveredCount: 1,
      startedAt: new Date(),
      finishedAt: new Date(),
      options: makeOptions(),
    });
    expect(summary.sitemap.sitemapEntriesFailed).toEqual(["https://summittrailgear.example/guides/gear-repair"]);
  });

  it("lists a crawled 2xx page absent from the sitemap under crawledNotInSitemap", () => {
    const page = makePage({ normalizedUrl: "http://localhost:3105/orphan-page" });
    const summary = buildSummary({
      pages: [page],
      failures: [],
      blocked: [],
      sitemap: { entries: [], files: [], errors: [] },
      discoveredCount: 1,
      startedAt: new Date(),
      finishedAt: new Date(),
      options: makeOptions(),
    });
    expect(summary.sitemap.crawledNotInSitemap).toEqual(["http://localhost:3105/orphan-page"]);
  });
});

describe("buildSummary — coverage math", () => {
  it("returns 0 coveragePercent when nothing was attempted", () => {
    const summary = buildSummary({
      pages: [],
      failures: [],
      blocked: [],
      sitemap: null,
      discoveredCount: 0,
      startedAt: new Date(),
      finishedAt: new Date(),
      options: makeOptions(),
    });
    expect(summary.coveragePercent).toBe(0);
    expect(summary.attempted).toBe(0);
  });

  it("rounds successful/attempted*100 to one decimal", () => {
    const pages = [
      makePage({ normalizedUrl: "https://ex.com/1" }),
      makePage({ normalizedUrl: "https://ex.com/2" }),
    ];
    const failures = [makeFailure({ url: "https://ex.com/3", normalizedUrl: "https://ex.com/3" })];
    const summary = buildSummary({
      pages,
      failures,
      blocked: [],
      sitemap: null,
      discoveredCount: 3,
      startedAt: new Date(),
      finishedAt: new Date(),
      options: makeOptions(),
    });
    expect(summary.attempted).toBe(3);
    expect(summary.successful).toBe(2);
    expect(summary.coveragePercent).toBeCloseTo(66.7, 1);
  });
});

describe("buildSummary — failuresByClass", () => {
  it("tallies failures by their reason class", () => {
    const failures = [
      makeFailure({ url: "https://ex.com/1", normalizedUrl: "https://ex.com/1", reason: "http-4xx" }),
      makeFailure({ url: "https://ex.com/2", normalizedUrl: "https://ex.com/2", reason: "http-4xx" }),
      makeFailure({ url: "https://ex.com/3", normalizedUrl: "https://ex.com/3", reason: "timeout" }),
    ];
    const summary = buildSummary({
      pages: [],
      failures,
      blocked: [],
      sitemap: null,
      discoveredCount: 3,
      startedAt: new Date(),
      finishedAt: new Date(),
      options: makeOptions(),
    });
    expect(summary.failuresByClass).toEqual({ "http-4xx": 2, timeout: 1 });
  });
});

describe("buildSummary — allowed/blocked/unique", () => {
  it("subtracts blocked from unique to get allowed, dedups across pages/failures/blocked", () => {
    const page = makePage({ normalizedUrl: "https://ex.com/a" });
    const failure = makeFailure({ url: "https://ex.com/b", normalizedUrl: "https://ex.com/b" });
    const summary = buildSummary({
      pages: [page],
      failures: [failure],
      blocked: ["https://ex.com/c", "https://ex.com/c"],
      sitemap: null,
      discoveredCount: 3,
      startedAt: new Date(),
      finishedAt: new Date(),
      options: makeOptions(),
    });
    expect(summary.unique).toBe(3);
    expect(summary.blockedByRobots).toBe(1);
    expect(summary.allowed).toBe(2);
  });
});

describe("printSummary", () => {
  it("prints the plan §20 block without throwing, includes the coverage sentence", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const summary = buildSummary({
      pages: [makePage()],
      failures: [],
      blocked: [],
      sitemap: null,
      discoveredCount: 1,
      startedAt: new Date("2026-01-01T00:00:00Z"),
      finishedAt: new Date("2026-01-01T00:02:41Z"),
      options: makeOptions(),
    });
    printSummary(summary);
    const output = spy.mock.calls[0]?.[0] as string;
    expect(output).toContain("========== CRAWL SUMMARY ==========");
    expect(output).toContain("02m 41s");
    expect(output).toContain("successful processing coverage");
    spy.mockRestore();
  });
});
