import { describe, expect, it } from "vitest";
import {
  authRequiredLinkRule,
  brokenInternalLinkRule,
  canonicalTargetValidityRule,
  weaklyLinkedRule,
  canonicalChainRule,
  excessiveLinksRule,
  vagueAnchorTextRule,
  highEmptyAnchorRatioRule,
  pageNoInternalLinksRule,
} from "../../../../src/analysis/rules/site/links";
import { makeConfig, makeContext, makeFailure, makeLink, makePage } from "./fixtures";

describe("weaklyLinkedRule", () => {
  it("fires for a non-seed page with exactly one internal inlink", () => {
    const source = makePage({
      url: "https://x.test/guides/first-time-backpacking",
      crawl: { depth: 1, parentUrl: "https://x.test/", discoverySources: ["html-link"] },
      links: [makeLink({ source: "https://x.test/guides/first-time-backpacking", target: "https://x.test/products/summit-stove" })],
    });
    const target = makePage({
      url: "https://x.test/products/summit-stove",
      crawl: { depth: 2, parentUrl: source.url, discoverySources: ["html-link"] },
    });
    const issues = weaklyLinkedRule.evaluate(makeContext({ pages: [source, target] }), makeConfig())!;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.url).toBe(target.url);
  });

  it("does not fire for the seed page even with few inlinks", () => {
    const seed = makePage({ url: "https://x.test/", crawl: { depth: 0, parentUrl: null, discoverySources: ["seed"] } });
    const issues = weaklyLinkedRule.evaluate(makeContext({ pages: [seed] }), makeConfig())!;
    expect(issues).toHaveLength(0);
  });

  it("does not fire for a page with 2+ inlinks", () => {
    const target = makePage({ url: "https://x.test/target", crawl: { depth: 1, parentUrl: null, discoverySources: [] } });
    const a = makePage({ url: "https://x.test/a", links: [makeLink({ source: "https://x.test/a", target: target.url })] });
    const b = makePage({ url: "https://x.test/b", links: [makeLink({ source: "https://x.test/b", target: target.url })] });
    const issues = weaklyLinkedRule.evaluate(makeContext({ pages: [a, b, target] }), makeConfig())!;
    expect(issues).toHaveLength(0);
  });

  it("treats weakInlinkCount as a ceiling, not an exact match — 2 inlinks fire when the threshold is 3", () => {
    const target = makePage({ url: "https://x.test/target", crawl: { depth: 1, parentUrl: null, discoverySources: [] } });
    const a = makePage({ url: "https://x.test/a", links: [makeLink({ source: "https://x.test/a", target: target.url })] });
    const b = makePage({ url: "https://x.test/b", links: [makeLink({ source: "https://x.test/b", target: target.url })] });
    const config = makeConfig({ thresholds: { ...makeConfig().thresholds, weakInlinkCount: 3 } });
    const issues = weaklyLinkedRule.evaluate(makeContext({ pages: [a, b, target] }), config)!;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.threshold).toBe("inlink count <= 3 (was 2)");
  });

  it("leaves a zero-inlink page to orphan-page even when the threshold would cover it", () => {
    const target = makePage({ url: "https://x.test/target", crawl: { depth: 1, parentUrl: null, discoverySources: [] } });
    const config = makeConfig({ thresholds: { ...makeConfig().thresholds, weakInlinkCount: 3 } });
    expect(weaklyLinkedRule.evaluate(makeContext({ pages: [target] }), config)!).toHaveLength(0);
  });

  it("does not count a page's self-links as inbound links", () => {
    const target = makePage({
      url: "https://x.test/target",
      crawl: { depth: 1, parentUrl: null, discoverySources: [] },
      links: [
        makeLink({ source: "https://x.test/target", target: "https://x.test/target" }),
        makeLink({ source: "https://x.test/target", target: "https://x.test/target#section" }),
      ],
    });
    const a = makePage({ url: "https://x.test/a", links: [makeLink({ source: "https://x.test/a", target: target.url })] });
    const issues = weaklyLinkedRule.evaluate(makeContext({ pages: [a, target] }), makeConfig())!;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("1 internal inlink(s)");
  });
});

describe("canonicalTargetValidityRule", () => {
  it("fires when the canonical target is a recorded failure", () => {
    const page = makePage({ url: "https://x.test/a", canonical: "https://x.test/broken" });
    const failures = [makeFailure({ url: "https://x.test/broken", reason: "http-4xx" })];
    const issues = canonicalTargetValidityRule.evaluate(makeContext({ pages: [page], failures }), makeConfig())!;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("4xx/5xx");
  });

  it("fires when the canonical target itself is noindexed", () => {
    const target = makePage({ url: "https://x.test/b", robots: { meta: ["noindex"], noindex: true, nofollow: false } });
    const page = makePage({ url: "https://x.test/a", canonical: "https://x.test/b" });
    const issues = canonicalTargetValidityRule.evaluate(makeContext({ pages: [page, target] }), makeConfig())!;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("noindex");
  });

  it("does not fire when canonical points at a healthy page (mismatch alone is a page-rule concern)", () => {
    const target = makePage({ url: "https://x.test/products/cascade-rain-shell" });
    const page = makePage({ url: "https://x.test/blog/rain-gear-care", canonical: "https://x.test/products/cascade-rain-shell" });
    const issues = canonicalTargetValidityRule.evaluate(makeContext({ pages: [page, target] }), makeConfig())!;
    expect(issues).toHaveLength(0);
  });

  it("does not fire (inconclusive, not flagged) when the canonical target was never crawled or recorded as a failure", () => {
    const page = makePage({ url: "https://x.test/a", canonical: "https://x.test/never-seen" });
    const issues = canonicalTargetValidityRule.evaluate(makeContext({ pages: [page] }), makeConfig())!;
    expect(issues).toHaveLength(0);
  });
});

describe("brokenInternalLinkRule", () => {
  it("fires when a link's target is a recorded 4xx failure", () => {
    const page = makePage({
      url: "https://x.test/",
      links: [makeLink({ source: "https://x.test/", target: "https://x.test/gear-sale" })],
    });
    const failures = [makeFailure({ url: "https://x.test/gear-sale", reason: "http-4xx", statusCode: 404 })];
    const issues = brokenInternalLinkRule.evaluate(makeContext({ pages: [page], failures }), makeConfig())!;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("error");
    expect(issues[0]!.evidence[0]!.field).toBe("links[0].targetNormalized");
  });

  it("does not fire for a healthy internal link", () => {
    const target = makePage({ url: "https://x.test/healthy" });
    const page = makePage({
      url: "https://x.test/",
      links: [makeLink({ source: "https://x.test/", target: "https://x.test/healthy" })],
    });
    const issues = brokenInternalLinkRule.evaluate(makeContext({ pages: [page, target], failures: [] }), makeConfig())!;
    expect(issues).toHaveLength(0);
  });

  it("ignores external links", () => {
    const page = makePage({
      url: "https://x.test/",
      links: [makeLink({ source: "https://x.test/", target: "https://elsewhere.test/broken", type: "external" })],
    });
    const failures = [makeFailure({ url: "https://elsewhere.test/broken", reason: "http-4xx" })];
    const issues = brokenInternalLinkRule.evaluate(makeContext({ pages: [page], failures }), makeConfig())!;
    expect(issues).toHaveLength(0);
  });
});

describe("auth-required vs broken links", () => {
  function linkingTo(targetUrl: string) {
    return makePage({ url: "https://x.test/", links: [makeLink({ source: "https://x.test/", target: targetUrl })] });
  }

  for (const status of [401, 403]) {
    it(`treats a ${status} target as auth-required, not broken`, () => {
      const ctx = makeContext({
        pages: [linkingTo("https://x.test/members")],
        failures: [makeFailure({ url: "https://x.test/members", reason: "http-4xx", statusCode: status })],
      });
      expect(brokenInternalLinkRule.evaluate(ctx, makeConfig())!).toHaveLength(0);
      const auth = authRequiredLinkRule.evaluate(ctx, makeConfig())!;
      expect(auth).toHaveLength(1);
      expect(auth[0]!.severity).toBe("notice");
      expect(auth[0]!.message).toContain(String(status));
    });
  }

  it("still reports a 404 target as broken, and never as auth-required", () => {
    const ctx = makeContext({
      pages: [linkingTo("https://x.test/gone")],
      failures: [makeFailure({ url: "https://x.test/gone", reason: "http-4xx", statusCode: 404 })],
    });
    expect(brokenInternalLinkRule.evaluate(ctx, makeConfig())!).toHaveLength(1);
    expect(authRequiredLinkRule.evaluate(ctx, makeConfig())!).toHaveLength(0);
  });

  it("still reports a 5xx target as broken", () => {
    const ctx = makeContext({
      pages: [linkingTo("https://x.test/boom")],
      failures: [makeFailure({ url: "https://x.test/boom", reason: "http-5xx", statusCode: 503 })],
    });
    expect(brokenInternalLinkRule.evaluate(ctx, makeConfig())!).toHaveLength(1);
  });

  it("reads the status from a crawled page record, not just the failure list", () => {
    const target = makePage({ url: "https://x.test/members", statusCode: 403 });
    const ctx = makeContext({ pages: [linkingTo("https://x.test/members"), target] });
    expect(brokenInternalLinkRule.evaluate(ctx, makeConfig())!).toHaveLength(0);
    expect(authRequiredLinkRule.evaluate(ctx, makeConfig())!).toHaveLength(1);
  });

  it("does not fire either rule for a healthy target", () => {
    const target = makePage({ url: "https://x.test/ok", statusCode: 200 });
    const ctx = makeContext({ pages: [linkingTo("https://x.test/ok"), target] });
    expect(brokenInternalLinkRule.evaluate(ctx, makeConfig())!).toHaveLength(0);
    expect(authRequiredLinkRule.evaluate(ctx, makeConfig())!).toHaveLength(0);
  });
});

describe("canonicalChainRule", () => {
  it("fires when the canonical target itself canonicalises onward (not to itself)", () => {
    const a = makePage({ url: "https://x.test/a", canonical: "https://x.test/b" });
    const b = makePage({ url: "https://x.test/b", canonical: "https://x.test/c" });
    const issues = canonicalChainRule.evaluate(makeContext({ pages: [a, b] }), makeConfig())!;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("warning");
    expect(issues[0]!.message).toContain("https://x.test/a");
  });

  it("does not fire when the target self-canonicalises (chain ends there)", () => {
    const a = makePage({ url: "https://x.test/a", canonical: "https://x.test/b" });
    const b = makePage({ url: "https://x.test/b", canonical: "https://x.test/b" });
    expect(canonicalChainRule.evaluate(makeContext({ pages: [a, b] }), makeConfig())!).toHaveLength(0);
  });

  it("does not fire when the page has no canonical", () => {
    const a = makePage({ url: "https://x.test/a", canonical: null });
    expect(canonicalChainRule.evaluate(makeContext({ pages: [a] }), makeConfig())!).toHaveLength(0);
  });

  it("does not fire when a page redirects straight to its own canonical target (found real false positive on arena.ai/cookie-policy)", () => {
    // pageByPath matches on finalUrl too, so a page whose OWN finalUrl equals the pathname of
    // its OWN canonical resolves "middle" back to itself — that's a correct self-referencing
    // canonical across a redirect, not a second canonical hop.
    const page = makePage({
      url: "https://x.test/cookie-policy",
      finalUrl: "https://help.x.test/articles/cookie-policy",
      canonical: "https://help.x.test/articles/cookie-policy",
    });
    expect(canonicalChainRule.evaluate(makeContext({ pages: [page] }), makeConfig())!).toHaveLength(0);
  });

  it("does not fire when a DIFFERENT alias also redirects+self-canonicalises to the same undercrawled destination (found real false positive on shop.nousresearch.com)", () => {
    // No page was ever independently crawled AT /collections/products itself — only aliases
    // that redirect there. pageByPath resolves "middle" to one of those aliases, whose own
    // canonical simply agrees with where IT lands, not a distinct second hop.
    const source = makePage({ url: "https://x.test/?country=IN", finalUrl: "https://x.test/collections/products", canonical: "https://x.test/collections/products" });
    const alias = makePage({ url: "https://x.test/", finalUrl: "https://x.test/collections/products", canonical: "https://x.test/collections/products" });
    expect(canonicalChainRule.evaluate(makeContext({ pages: [source, alias] }), makeConfig())!).toHaveLength(0);
  });
});

describe("excessiveLinksRule", () => {
  it("fires when a page's link count exceeds the configured max", () => {
    const links = Array.from({ length: 5 }, (_, i) => makeLink({ source: "https://x.test/", target: `https://x.test/p${i}` }));
    const page = makePage({ url: "https://x.test/", links });
    const config = makeConfig({ thresholds: { ...makeConfig().thresholds, excessiveLinksCount: 3 } });
    const issues = excessiveLinksRule.evaluate(makeContext({ pages: [page] }), config)!;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.threshold).toContain("max 3");
  });

  it("does not fire under the max", () => {
    const page = makePage({ url: "https://x.test/", links: [makeLink({ source: "https://x.test/", target: "https://x.test/p" })] });
    expect(excessiveLinksRule.evaluate(makeContext({ pages: [page] }), makeConfig())!).toHaveLength(0);
  });
});

describe("vagueAnchorTextRule", () => {
  it("fires on 'click here' style anchor text", () => {
    const page = makePage({
      url: "https://x.test/",
      links: [makeLink({ source: "https://x.test/", target: "https://x.test/guide", anchor: "click here" })],
    });
    const issues = vagueAnchorTextRule.evaluate(makeContext({ pages: [page] }), makeConfig())!;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("notice");
  });

  it("does not fire on descriptive anchor text", () => {
    const page = makePage({
      url: "https://x.test/",
      links: [makeLink({ source: "https://x.test/", target: "https://x.test/guide", anchor: "read the pricing guide" })],
    });
    expect(vagueAnchorTextRule.evaluate(makeContext({ pages: [page] }), makeConfig())!).toHaveLength(0);
  });
});

describe("highEmptyAnchorRatioRule", () => {
  it("fires when over the configured share of internal links have blank anchor text", () => {
    const links = [
      makeLink({ source: "https://x.test/", target: "https://x.test/a", anchor: "" }),
      makeLink({ source: "https://x.test/", target: "https://x.test/b", anchor: "" }),
      makeLink({ source: "https://x.test/", target: "https://x.test/c", anchor: "real text" }),
    ];
    const page = makePage({ url: "https://x.test/", links });
    const issues = highEmptyAnchorRatioRule.evaluate(makeContext({ pages: [page] }), makeConfig())!;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("2 of 3");
  });

  it("does not fire when under the ratio", () => {
    const links = [
      makeLink({ source: "https://x.test/", target: "https://x.test/a", anchor: "one" }),
      makeLink({ source: "https://x.test/", target: "https://x.test/b", anchor: "two" }),
      makeLink({ source: "https://x.test/", target: "https://x.test/c", anchor: "three" }),
      makeLink({ source: "https://x.test/", target: "https://x.test/d", anchor: "" }),
    ];
    const page = makePage({ url: "https://x.test/", links }); // 1/4 = 0.25, under the 0.3 default
    expect(highEmptyAnchorRatioRule.evaluate(makeContext({ pages: [page] }), makeConfig())!).toHaveLength(0);
  });
});

describe("pageNoInternalLinksRule", () => {
  it("fires when a successfully loaded page links to nothing internal", () => {
    const page = makePage({
      url: "https://x.test/",
      statusCode: 200,
      links: [makeLink({ source: "https://x.test/", target: "https://elsewhere.test/", type: "external" })],
    });
    const issues = pageNoInternalLinksRule.evaluate(makeContext({ pages: [page] }), makeConfig())!;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("warning");
  });

  it("does not fire when the page has at least one internal link", () => {
    const page = makePage({
      url: "https://x.test/",
      statusCode: 200,
      links: [makeLink({ source: "https://x.test/", target: "https://x.test/about" })],
    });
    expect(pageNoInternalLinksRule.evaluate(makeContext({ pages: [page] }), makeConfig())!).toHaveLength(0);
  });

  it("does not fire on a page that failed to load", () => {
    const page = makePage({ url: "https://x.test/broken", statusCode: 404, links: [] });
    expect(pageNoInternalLinksRule.evaluate(makeContext({ pages: [page] }), makeConfig())!).toHaveLength(0);
  });
});
