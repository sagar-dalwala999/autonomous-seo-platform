/** Slice C2 — minimal CrawledPage/LinkRecord builders for graph tests (mirrors the analyzer's
 * tests/unit/analysis/site/fixtures.ts shape). */
import { createHash } from "node:crypto";
import type { CrawledPage, LinkRecord } from "../../../src/models/types";

function hashOf(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function makeLink(source: string, target: string, overrides?: Partial<LinkRecord>): LinkRecord {
  return {
    source,
    target,
    targetNormalized: target,
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

export function makePage(overrides: Partial<CrawledPage> & { url: string }): CrawledPage {
  const normalizedUrl = overrides.normalizedUrl ?? overrides.url;
  const base: CrawledPage = {
    runId: "test-run",
    url: overrides.url,
    normalizedUrl,
    finalUrl: overrides.finalUrl ?? overrides.url,
    statusCode: 200,
    redirectChain: [],
    headers: {},
    performance: { responseTimeMs: 100 },
    renderedWith: "http",
    renderSignals: [],
    fetchedAt: "2026-08-12T00:00:00.000Z",
    crawl: { depth: 0, parentUrl: null, discoverySources: ["html-link"] },
    title: "Default Title",
    metaDescription: "Default description",
    canonical: null,
    robots: { meta: [], noindex: false, nofollow: false },
    headings: { h1: ["Default Title"], h2: [], h3: [] },
    links: [],
    images: [],
    videos: [],
    structuredData: [],
    content: { text: "word ".repeat(200).trim(), wordCount: 200, contentHash: hashOf(normalizedUrl) },
  };
  return { ...base, ...overrides };
}
