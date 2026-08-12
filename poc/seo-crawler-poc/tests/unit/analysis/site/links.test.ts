import { describe, expect, it } from "vitest";
import { brokenInternalLinkRule, canonicalTargetValidityRule, weaklyLinkedRule } from "../../../../src/analysis/rules/site/links";
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
