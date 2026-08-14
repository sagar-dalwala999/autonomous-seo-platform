/** Slice A4 — shared test fixtures: hand-built CrawledPage / SiteRuleContext / AnalysisConfig. */
import { createHash } from "node:crypto";
import type {
  CrawledPage,
  FailureRecord,
  LinkRecord,
  RobotsEvidence,
  SitemapResult,
} from "../../../../src/models/types";
import type { AnalysisConfig } from "../../../../src/analysis/config";
import type { SiteRuleContext } from "../../../../src/analysis/rules/site";

function hashOf(s: string): string {
  return createHash("sha256").update(s).digest("hex");
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
    crawl: { depth: 1, parentUrl: "https://example.test/", discoverySources: ["html-link"] },
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

export function makeLink(overrides: Partial<LinkRecord> & { source: string; target: string }): LinkRecord {
  return {
    source: overrides.source,
    target: overrides.target,
    targetNormalized: overrides.targetNormalized ?? overrides.target,
    anchor: overrides.anchor ?? "link",
    type: overrides.type ?? "internal",
    rel: overrides.rel ?? null,
    nofollow: overrides.nofollow ?? false,
    sponsored: overrides.sponsored ?? false,
    ugc: overrides.ugc ?? false,
    targetAttr: overrides.targetAttr ?? null,
  };
}

export function makeFailure(overrides: Partial<FailureRecord> & { url: string; reason: FailureRecord["reason"] }): FailureRecord {
  return {
    url: overrides.url,
    normalizedUrl: overrides.normalizedUrl ?? overrides.url,
    reason: overrides.reason,
    statusCode: overrides.statusCode ?? null,
    attempts: overrides.attempts ?? 1,
    error: overrides.error ?? null,
    depth: overrides.depth ?? null,
    parentUrl: overrides.parentUrl ?? null,
  };
}

export function makeConfig(overrides?: Partial<AnalysisConfig>): AnalysisConfig {
  return {
    rulebookVersion: "test",
    rules: {},
    thresholds: {
      titleMinChars: 30,
      titleMaxChars: 60,
      titleMaxPx: 600,
      descMinChars: 70,
      descMaxChars: 155,
      descMaxPx: 920,
      thinContentWords: 80,
      lowTextRatio: 0.1,
      slowPageMs: 3000,
      redirectChainMax: 1,
      nearDupWordCountDeltaPct: 5,
      weakInlinkCount: 1,
    },
    ...overrides,
  };
}

export function makeContext(overrides: Partial<SiteRuleContext>): SiteRuleContext {
  return {
    pages: overrides.pages ?? [],
    failures: overrides.failures ?? [],
    blocked: overrides.blocked ?? [],
    sitemap: overrides.sitemap ?? null,
    robots: overrides.robots ?? null,
    summary: overrides.summary ?? null,
  };
}

export function makeSitemap(overrides: Partial<SitemapResult>): SitemapResult {
  return {
    entries: overrides.entries ?? [],
    files: overrides.files ?? [],
    errors: overrides.errors ?? [],
    // Spread after the defaults so optional fields (lastmodTrust, crossHostEntryCount) pass
    // through — they were previously silently dropped, which is a fixture bug, not a rule bug.
    ...overrides,
  };
}

export const emptyRobots: RobotsEvidence = {
  url: "https://example.test/robots.txt",
  statusCode: 200,
  content: "User-agent: *\nAllow: /",
  sitemaps: [],
  parseStatus: "ok",
  fetchedAt: "2026-08-12T00:00:00.000Z",
};
