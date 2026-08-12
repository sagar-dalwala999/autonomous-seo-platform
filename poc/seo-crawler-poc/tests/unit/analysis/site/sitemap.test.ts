import { describe, expect, it } from "vitest";
import {
  crawledNotInSitemapRule,
  inSitemapNotCrawledRule,
  sitemap404Rule,
  sitemapNoindexIncludedRule,
} from "../../../../src/analysis/rules/site/sitemap";
import { makeConfig, makeContext, makeFailure, makePage, makeSitemap } from "./fixtures";

describe("sitemap404Rule", () => {
  it("fires when a sitemap entry matches a recorded http-4xx failure", () => {
    const sitemap = makeSitemap({ entries: [{ url: "https://x.test/guides/gear-repair", sourceSitemap: "https://x.test/sitemap.xml" }] });
    const failures = [makeFailure({ url: "https://x.test/guides/gear-repair", reason: "http-4xx", statusCode: 404 })];
    const issues = sitemap404Rule.evaluate(makeContext({ sitemap, failures }), makeConfig())!;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("warning");
  });

  it("does not fire for a healthy sitemap entry", () => {
    const sitemap = makeSitemap({ entries: [{ url: "https://x.test/about", sourceSitemap: "https://x.test/sitemap.xml" }] });
    const issues = sitemap404Rule.evaluate(makeContext({ sitemap, failures: [] }), makeConfig())!;
    expect(issues).toHaveLength(0);
  });

  it("returns null when no sitemap was fetched", () => {
    expect(sitemap404Rule.evaluate(makeContext({ sitemap: null }), makeConfig())).toBeNull();
  });
});

describe("sitemapNoindexIncludedRule", () => {
  it("fires when a noindex page is listed in the sitemap", () => {
    const page = makePage({ url: "https://x.test/products/switchback-trekking-poles", robots: { meta: ["noindex"], noindex: true, nofollow: false } });
    const sitemap = makeSitemap({ entries: [{ url: "https://x.test/products/switchback-trekking-poles", sourceSitemap: "s.xml" }] });
    const issues = sitemapNoindexIncludedRule.evaluate(makeContext({ pages: [page], sitemap }), makeConfig())!;
    expect(issues).toHaveLength(1);
  });

  it("does not fire for an indexable page in the sitemap", () => {
    const page = makePage({ url: "https://x.test/about" });
    const sitemap = makeSitemap({ entries: [{ url: "https://x.test/about", sourceSitemap: "s.xml" }] });
    const issues = sitemapNoindexIncludedRule.evaluate(makeContext({ pages: [page], sitemap }), makeConfig())!;
    expect(issues).toHaveLength(0);
  });
});

describe("inSitemapNotCrawledRule", () => {
  it("fires for a sitemap entry never crawled and not a recorded failure", () => {
    const sitemap = makeSitemap({ entries: [{ url: "https://x.test/never-reached", sourceSitemap: "s.xml" }] });
    const issues = inSitemapNotCrawledRule.evaluate(makeContext({ sitemap, pages: [], failures: [] }), makeConfig())!;
    expect(issues).toHaveLength(1);
  });

  it("does not double-count a sitemap 404 entry as not-crawled", () => {
    const sitemap = makeSitemap({ entries: [{ url: "https://x.test/gear-repair", sourceSitemap: "s.xml" }] });
    const failures = [makeFailure({ url: "https://x.test/gear-repair", reason: "http-4xx" })];
    const issues = inSitemapNotCrawledRule.evaluate(makeContext({ sitemap, failures }), makeConfig())!;
    expect(issues).toHaveLength(0);
  });
});

describe("crawledNotInSitemapRule", () => {
  it("fires for a successfully crawled page absent from the sitemap", () => {
    const page = makePage({ url: "https://x.test/contact" });
    const sitemap = makeSitemap({ entries: [{ url: "https://x.test/about", sourceSitemap: "s.xml" }] });
    const issues = crawledNotInSitemapRule.evaluate(makeContext({ pages: [page], sitemap }), makeConfig())!;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.url).toBe("https://x.test/contact");
  });

  it("does not fire when the page is listed in the sitemap", () => {
    const page = makePage({ url: "https://x.test/about" });
    const sitemap = makeSitemap({ entries: [{ url: "https://x.test/about", sourceSitemap: "s.xml" }] });
    const issues = crawledNotInSitemapRule.evaluate(makeContext({ pages: [page], sitemap }), makeConfig())!;
    expect(issues).toHaveLength(0);
  });
});
