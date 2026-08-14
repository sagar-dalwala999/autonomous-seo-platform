import { describe, expect, it } from "vitest";
import {
  crawledNotInSitemapRule,
  inSitemapNotCrawledRule,
  sitemap404Rule,
  sitemapNoindexIncludedRule,
  sitemapTooManyUrlsRule,
  noSitemapFoundRule,
  sitemapListsBlockedUrlsRule,
  sitemapPageNoInlinksRule,
  sitemapUrlNoncanonicalRule,
  sitemapLastmodSuspectRule,
} from "../../../../src/analysis/rules/site/sitemap";
import { makeConfig, makeContext, makeFailure, makeLink, makePage, makeSitemap } from "./fixtures";

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

describe("noSitemapFoundRule", () => {
  it("fires when the sitemap was fetched but resolved to zero entries", () => {
    const ctx = makeContext({ sitemap: makeSitemap({ entries: [] }) });
    const issues = noSitemapFoundRule.evaluate(ctx, makeConfig())!;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("warning");
  });

  it("does not fire when the sitemap has entries", () => {
    const ctx = makeContext({ sitemap: makeSitemap({ entries: [{ url: "https://x.test/a", sourceSitemap: "s.xml" }] }) });
    expect(noSitemapFoundRule.evaluate(ctx, makeConfig())!).toHaveLength(0);
  });

  it("returns null (data unavailable) when sitemaps.json was never written (pre-feature run)", () => {
    expect(noSitemapFoundRule.evaluate(makeContext({ sitemap: null }), makeConfig())).toBeNull();
  });
});

describe("sitemapListsBlockedUrlsRule", () => {
  it("fires when a sitemap entry is also disallowed by robots.txt", () => {
    const sitemap = makeSitemap({ entries: [{ url: "https://x.test/private", sourceSitemap: "s.xml" }] });
    const issues = sitemapListsBlockedUrlsRule.evaluate(makeContext({ sitemap, blocked: ["https://x.test/private"] }), makeConfig())!;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("warning");
  });

  it("does not fire when nothing in the sitemap is blocked", () => {
    const sitemap = makeSitemap({ entries: [{ url: "https://x.test/about", sourceSitemap: "s.xml" }] });
    expect(sitemapListsBlockedUrlsRule.evaluate(makeContext({ sitemap, blocked: [] }), makeConfig())!).toHaveLength(0);
  });

  it("returns null (data unavailable) when no sitemap was fetched", () => {
    expect(sitemapListsBlockedUrlsRule.evaluate(makeContext({ sitemap: null }), makeConfig())).toBeNull();
  });
});

describe("sitemapPageNoInlinksRule", () => {
  it("fires when a crawled, non-seed sitemap page has zero internal inlinks", () => {
    const page = makePage({ url: "https://x.test/deep-page", crawl: { depth: 2, parentUrl: "https://x.test/", discoverySources: ["sitemap"] } });
    const sitemap = makeSitemap({ entries: [{ url: "https://x.test/deep-page", sourceSitemap: "s.xml" }] });
    const issues = sitemapPageNoInlinksRule.evaluate(makeContext({ pages: [page], sitemap }), makeConfig())!;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("notice");
  });

  it("does not fire when another crawled page links to it", () => {
    const target = makePage({ url: "https://x.test/deep-page", crawl: { depth: 2, parentUrl: null, discoverySources: [] } });
    const source = makePage({
      url: "https://x.test/hub",
      links: [makeLink({ source: "https://x.test/hub", target: "https://x.test/deep-page" })],
    });
    const sitemap = makeSitemap({ entries: [{ url: "https://x.test/deep-page", sourceSitemap: "s.xml" }] });
    const issues = sitemapPageNoInlinksRule.evaluate(makeContext({ pages: [target, source], sitemap }), makeConfig())!;
    expect(issues).toHaveLength(0);
  });

  it("returns null (data unavailable) when no sitemap was fetched", () => {
    expect(sitemapPageNoInlinksRule.evaluate(makeContext({ sitemap: null }), makeConfig())).toBeNull();
  });
});

describe("sitemapUrlNoncanonicalRule", () => {
  it("fires when a sitemap-listed page's canonical points elsewhere", () => {
    const page = makePage({ url: "https://x.test/a", canonical: "https://x.test/b" });
    const sitemap = makeSitemap({ entries: [{ url: "https://x.test/a", sourceSitemap: "s.xml" }] });
    const issues = sitemapUrlNoncanonicalRule.evaluate(makeContext({ pages: [page], sitemap }), makeConfig())!;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("warning");
  });

  it("does not fire when the canonical is self-referencing", () => {
    const page = makePage({ url: "https://x.test/a", canonical: "https://x.test/a" });
    const sitemap = makeSitemap({ entries: [{ url: "https://x.test/a", sourceSitemap: "s.xml" }] });
    expect(sitemapUrlNoncanonicalRule.evaluate(makeContext({ pages: [page], sitemap }), makeConfig())!).toHaveLength(0);
  });

  it("returns null (data unavailable) when no sitemap was fetched", () => {
    expect(sitemapUrlNoncanonicalRule.evaluate(makeContext({ sitemap: null }), makeConfig())).toBeNull();
  });
});

describe("sitemapLastmodSuspectRule", () => {
  const trust = (overrides: Partial<import("../../../../src/models/types").SitemapLastmodTrust>) => ({
    totalUrls: 10,
    withLastmod: 10,
    invalid: 0,
    distinctValues: 10,
    future: 0,
    withinLastHour: 0,
    allIdentical: false,
    newest: "2026-08-01T00:00:00Z",
    oldest: "2026-01-01T00:00:00Z",
    verdict: "trustworthy" as const,
    ...overrides,
  });

  it("fires when the verdict is a suspect- variant", () => {
    const sitemap = makeSitemap({ lastmodTrust: trust({ verdict: "suspect-future", future: 3 }) });
    const issues = sitemapLastmodSuspectRule.evaluate(makeContext({ sitemap }), makeConfig())!;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("notice");
  });

  it("does not fire when the verdict is trustworthy", () => {
    const sitemap = makeSitemap({ lastmodTrust: trust({ verdict: "trustworthy" }) });
    expect(sitemapLastmodSuspectRule.evaluate(makeContext({ sitemap }), makeConfig())!).toHaveLength(0);
  });

  it("returns null (data unavailable) when lastmodTrust was never computed", () => {
    const sitemap = makeSitemap({});
    expect(sitemapLastmodSuspectRule.evaluate(makeContext({ sitemap }), makeConfig())).toBeNull();
    expect(sitemapLastmodSuspectRule.evaluate(makeContext({ sitemap: null }), makeConfig())).toBeNull();
  });
});
