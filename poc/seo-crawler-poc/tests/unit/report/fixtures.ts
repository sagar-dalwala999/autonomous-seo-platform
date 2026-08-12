import type { CrawledPage, CrawlOptions, FailureRecord, LinkRecord } from "../../../src/models/types";

export function makeLink(overrides: Partial<LinkRecord> = {}): LinkRecord {
  return {
    source: "https://ex.com/",
    target: "https://ex.com/a",
    targetNormalized: "https://ex.com/a",
    anchor: "link",
    type: "internal",
    rel: null,
    nofollow: false,
    sponsored: false,
    ugc: false,
    targetAttr: null,
    ...overrides,
  };
}

export function makePage(overrides: Partial<CrawledPage> = {}): CrawledPage {
  return {
    runId: "run-1",
    url: "https://ex.com/",
    normalizedUrl: "https://ex.com/",
    finalUrl: "https://ex.com/",
    statusCode: 200,
    redirectChain: [],
    headers: {},
    performance: { responseTimeMs: 100 },
    renderedWith: "http",
    renderSignals: [],
    fetchedAt: "2026-01-01T00:00:00.000Z",
    crawl: { depth: 0, parentUrl: null, discoverySources: ["seed"] },
    title: "Title",
    metaDescription: "Desc",
    canonical: null,
    robots: { meta: [], noindex: false, nofollow: false },
    headings: { h1: [], h2: [], h3: [] },
    links: [],
    images: [],
    videos: [],
    structuredData: [],
    content: { text: "hello", wordCount: 1, contentHash: "abc123" },
    titles: ["Title"],
    metaDescriptions: ["Desc"],
    social: { og: {}, twitter: {} },
    hreflang: [],
    metaRefresh: null,
    metaKeywords: null,
    pixelWidths: { titlePx: null, metaDescriptionPx: null },
    pageStats: { htmlBytes: 100, textRatio: 0.1, domNodes: 10, contentEncoding: null, httpVersion: null },
    renderDivergence: null,
    ...overrides,
  };
}

export function makeFailure(overrides: Partial<FailureRecord> = {}): FailureRecord {
  return {
    url: "https://ex.com/broken",
    normalizedUrl: "https://ex.com/broken",
    reason: "http-4xx",
    statusCode: 404,
    attempts: 1,
    error: null,
    depth: 1,
    parentUrl: "https://ex.com/",
    ...overrides,
  };
}

export function makeOptions(overrides: Partial<CrawlOptions> = {}): CrawlOptions {
  return {
    startUrl: "https://ex.com/",
    maxPages: 100,
    concurrency: 5,
    respectRobots: true,
    render: "auto",
    outDir: "storage",
    runId: "run-1",
    userAgent: "seo-crawler-poc",
    maxRequestsPerSecond: 10,
    hostAliases: [],
    maxDepth: null,
    ...overrides,
  };
}
