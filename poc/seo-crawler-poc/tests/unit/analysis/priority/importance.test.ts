import { describe, expect, it } from "vitest";
import { buildImportanceIndex, buildSitemapPathSet } from "../../../../src/analysis/priority/importance";
import type { CrawledPage, GraphReport, SitemapResult } from "../../../../src/models/types";
import { makePage } from "../../report/fixtures";

function entry(overrides: Partial<CrawledPage> & { url: string }, depth = 0) {
  const page = makePage({ ...overrides, crawl: { depth, parentUrl: null, discoverySources: ["html-link"] } });
  return { page, pageId: page.url.replace(/[^a-z0-9]/gi, "") };
}

describe("buildImportanceIndex", () => {
  it("never returns 0, even with no graph, no sitemap, and a deep page with no inlinks", () => {
    const e = entry({ url: "https://ex.com/deep/deep/deep/deep" }, 9);
    const { index } = buildImportanceIndex([e], null, null);
    const score = index.get(e.pageId)!.score;
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("falls back to depth+inlinks (never crashes, never 0) when no graph report is available", () => {
    const e = entry({ url: "https://ex.com/a" }, 0);
    const { index, graphAvailable } = buildImportanceIndex([e], null, null);
    expect(graphAvailable).toBe(false);
    expect(index.get(e.pageId)!.source).toBe("fallback-depth-inlinks");
    expect(index.get(e.pageId)!.score).toBeGreaterThan(0);
  });

  it("prefers real PageRank (internalRank) over the fallback when a graph report is present", () => {
    const e = entry({ url: "https://ex.com/a" }, 0);
    const graph: GraphReport = {
      runId: "r",
      generatedAt: "now",
      dampingFactor: 0.85,
      iterations: 1,
      converged: true,
      pages: [{ pageId: e.pageId, url: e.page.url, internalRank: 100, rawRank: 0.5, inlinks: 10, uniqueInlinks: 8, outlinks: 2, depth: 0 }],
      orphans: [],
    };
    const { index, graphAvailable } = buildImportanceIndex([e], graph, null);
    expect(graphAvailable).toBe(true);
    expect(index.get(e.pageId)!.source).toBe("pagerank");
  });

  it("home page (depth 0, top PageRank) scores higher than a deep orphaned page", () => {
    const home = entry({ url: "https://ex.com/" }, 0);
    const deep = entry({ url: "https://ex.com/deep" }, 6);
    const graph: GraphReport = {
      runId: "r",
      generatedAt: "now",
      dampingFactor: 0.85,
      iterations: 1,
      converged: true,
      pages: [
        { pageId: home.pageId, url: home.page.url, internalRank: 100, rawRank: 0.5, inlinks: 50, uniqueInlinks: 40, outlinks: 10, depth: 0 },
        { pageId: deep.pageId, url: deep.page.url, internalRank: 5, rawRank: 0.001, inlinks: 0, uniqueInlinks: 0, outlinks: 0, depth: 6 },
      ],
      orphans: [deep.page.url],
    };
    const { index } = buildImportanceIndex([home, deep], graph, null);
    expect(index.get(home.pageId)!.score).toBeGreaterThan(index.get(deep.pageId)!.score);
  });

  it("sitemap presence nudges importance up; a sitemap that omits the page nudges it down — never to 0", () => {
    const inSitemap = entry({ url: "https://ex.com/in", normalizedUrl: "https://ex.com/in" }, 1);
    const outSitemap = entry({ url: "https://ex.com/out", normalizedUrl: "https://ex.com/out" }, 1);
    const sitemap: SitemapResult = {
      entries: [{ url: "https://ex.com/in", sourceSitemap: "https://ex.com/sitemap.xml" }],
      files: [],
      errors: [],
    };
    const { index } = buildImportanceIndex([inSitemap, outSitemap], null, sitemap);
    expect(index.get(inSitemap.pageId)!.score).toBeGreaterThan(index.get(outSitemap.pageId)!.score);
    expect(index.get(outSitemap.pageId)!.score).toBeGreaterThan(0);
  });

  it("absence of any sitemap at all is neutral, not a penalty", () => {
    const withoutSitemapData = entry({ url: "https://ex.com/a" }, 1);
    const { index: noSitemapIndex } = buildImportanceIndex([withoutSitemapData], null, null);
    const emptySitemap: SitemapResult = { entries: [], files: [], errors: [] };
    const { index: emptySitemapIndex } = buildImportanceIndex([withoutSitemapData], null, emptySitemap);
    // Page missing from a sitemap that DOES exist scores lower than a crawl with no sitemap at all.
    expect(noSitemapIndex.get(withoutSitemapData.pageId)!.score).toBeGreaterThan(
      emptySitemapIndex.get(withoutSitemapData.pageId)!.score,
    );
  });

  it("meanImportance is the simple average across all analyzed pages", () => {
    const a = entry({ url: "https://ex.com/a" }, 0);
    const b = entry({ url: "https://ex.com/b" }, 5);
    const { index, meanImportance } = buildImportanceIndex([a, b], null, null);
    const expected = (index.get(a.pageId)!.score + index.get(b.pageId)!.score) / 2;
    expect(meanImportance).toBeCloseTo(expected, 10);
  });
});

describe("buildSitemapPathSet", () => {
  it("returns an empty set for a null sitemap", () => {
    expect(buildSitemapPathSet(null).size).toBe(0);
  });

  it("collects pathnames from entries", () => {
    const sitemap: SitemapResult = {
      entries: [{ url: "https://ex.com/a", sourceSitemap: "s" }, { url: "https://ex.com/b/", sourceSitemap: "s" }],
      files: [],
      errors: [],
    };
    const set = buildSitemapPathSet(sitemap);
    expect(set.has("/a")).toBe(true);
    expect(set.has("/b")).toBe(true); // trailing slash stripped, matching helpers.ts's pathnameOf convention
  });
});
