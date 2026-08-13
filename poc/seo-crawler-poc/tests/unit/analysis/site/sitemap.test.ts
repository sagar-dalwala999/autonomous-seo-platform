import { describe, expect, it } from "vitest";
import {
  crawledNotInSitemapRule,
  inSitemapNotCrawledRule,
  sitemap404Rule,
  sitemapNoindexIncludedRule,
  sitemapTooManyUrlsRule,
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

describe("sitemapTooManyUrlsRule", () => {
  const file = (url: string, urlCount: number) => ({ url, statusCode: 200, kind: "urlset" as const, urlCount, error: null });

  it("fires when a sitemap file exceeds the 50,000 URL protocol limit", () => {
    const ctx = makeContext({ sitemap: makeSitemap({ files: [file("https://x.test/sitemap.xml", 50_001)] }) });
    const issues = sitemapTooManyUrlsRule.evaluate(ctx, makeConfig())!;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("error"); // invalid file, not merely a large one
    expect(issues[0]!.evidence[0]!.field).toBe("sitemap.files[0].urlCount");
  });

  it("does not fire exactly at the limit", () => {
    const ctx = makeContext({ sitemap: makeSitemap({ files: [file("https://x.test/sitemap.xml", 50_000)] }) });
    expect(sitemapTooManyUrlsRule.evaluate(ctx, makeConfig())).toHaveLength(0);
  });

  it("flags only the oversized file when several are present", () => {
    const ctx = makeContext({
      sitemap: makeSitemap({ files: [file("https://x.test/a.xml", 10), file("https://x.test/b.xml", 60_000)] }),
    });
    const issues = sitemapTooManyUrlsRule.evaluate(ctx, makeConfig())!;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.url).toBe("https://x.test/b.xml");
  });

  it("returns null (data unavailable) when no sitemap was fetched, rather than passing", () => {
    expect(sitemapTooManyUrlsRule.evaluate(makeContext({ sitemap: null }), makeConfig())).toBeNull();
  });
});
