import { describe, expect, it } from "vitest";
import {
  duplicateTitleRule,
  duplicateDescriptionRule,
  exactDuplicateContentRule,
  nearDuplicateContentRule,
} from "../../../../src/analysis/rules/site/duplicates";
import { makeConfig, makeContext, makePage } from "./fixtures";

describe("duplicateTitleRule", () => {
  it("fires for a title shared by 2+ pages", () => {
    const a = makePage({ url: "https://x.test/blog/rain-gear-care", title: "Rain Gear Care Tips" });
    const b = makePage({ url: "https://x.test/blog/layering-basics", title: "Rain Gear Care Tips" });
    const ctx = makeContext({ pages: [a, b] });
    const issues = duplicateTitleRule.evaluate(ctx, makeConfig())!;
    expect(issues).toHaveLength(2);
    expect(issues.every((i) => i.ruleId === "duplicate-title" && i.severity === "warning")).toBe(true);
    expect(issues[0]!.evidence.some((e) => e.pageId)).toBe(true);
  });

  it("does not fire for a singleton title", () => {
    const a = makePage({ url: "https://x.test/a", title: "Unique A" });
    const b = makePage({ url: "https://x.test/b", title: "Unique B" });
    const issues = duplicateTitleRule.evaluate(makeContext({ pages: [a, b] }), makeConfig())!;
    expect(issues).toHaveLength(0);
  });

  it("ignores null titles (missing-title is a different rule)", () => {
    const a = makePage({ url: "https://x.test/a", title: null });
    const b = makePage({ url: "https://x.test/b", title: null });
    const issues = duplicateTitleRule.evaluate(makeContext({ pages: [a, b] }), makeConfig())!;
    expect(issues).toHaveLength(0);
  });

  it("respects config severity override and enabled=false", () => {
    const a = makePage({ url: "https://x.test/a", title: "Same" });
    const b = makePage({ url: "https://x.test/b", title: "Same" });
    const ctx = makeContext({ pages: [a, b] });
    const overridden = duplicateTitleRule.evaluate(ctx, makeConfig({ rules: { "duplicate-title": { severity: "error" } } }))!;
    expect(overridden[0]!.severity).toBe("error");
    const disabled = duplicateTitleRule.evaluate(ctx, makeConfig({ rules: { "duplicate-title": { enabled: false } } }));
    expect(disabled).toBeNull();
  });
});

describe("duplicateDescriptionRule", () => {
  it("fires for a shared metaDescription", () => {
    const a = makePage({ url: "https://x.test/blog/backpack-fitting", metaDescription: "Same desc" });
    const b = makePage({ url: "https://x.test/blog/choosing-hiking-boots", metaDescription: "Same desc" });
    const issues = duplicateDescriptionRule.evaluate(makeContext({ pages: [a, b] }), makeConfig())!;
    expect(issues).toHaveLength(2);
    expect(issues.every((i) => i.ruleId === "duplicate-description")).toBe(true);
  });

  it("does not fire when descriptions differ", () => {
    const a = makePage({ url: "https://x.test/a", metaDescription: "One" });
    const b = makePage({ url: "https://x.test/b", metaDescription: "Two" });
    const issues = duplicateDescriptionRule.evaluate(makeContext({ pages: [a, b] }), makeConfig())!;
    expect(issues).toHaveLength(0);
  });
});

describe("exactDuplicateContentRule", () => {
  it("fires when contentHash matches exactly", () => {
    const a = makePage({ url: "https://x.test/a", content: { text: "same body", wordCount: 50, contentHash: "hash1" } });
    const b = makePage({ url: "https://x.test/b", content: { text: "same body", wordCount: 50, contentHash: "hash1" } });
    const issues = exactDuplicateContentRule.evaluate(makeContext({ pages: [a, b] }), makeConfig())!;
    expect(issues).toHaveLength(2);
  });

  it("does not fire for distinct hashes and skips zero-wordcount pages", () => {
    const a = makePage({ url: "https://x.test/a", content: { text: "", wordCount: 0, contentHash: "same-hash" } });
    const b = makePage({ url: "https://x.test/b", content: { text: "", wordCount: 0, contentHash: "same-hash" } });
    const issues = exactDuplicateContentRule.evaluate(makeContext({ pages: [a, b] }), makeConfig())!;
    expect(issues).toHaveLength(0);
  });
});

describe("nearDuplicateContentRule", () => {
  it("fires for two pages in the same section within the wordCount delta threshold", () => {
    const a = makePage({
      url: "https://x.test/blog/winter-hiking-checklist",
      content: { text: "a".repeat(1000), wordCount: 300, contentHash: "hashA" },
    });
    const b = makePage({
      url: "https://x.test/blog/winter-day-hike-checklist",
      content: { text: "a".repeat(980), wordCount: 290, contentHash: "hashB" },
    });
    const issues = nearDuplicateContentRule.evaluate(makeContext({ pages: [a, b] }), makeConfig())!;
    expect(issues).toHaveLength(2);
    expect(issues.every((i) => i.severity === "notice")).toBe(true);
    expect(issues[0]!.threshold).toContain("wordCount delta");
  });

  it("does not fire across different sections even with matching wordCount", () => {
    const a = makePage({ url: "https://x.test/blog/a", content: { text: "x", wordCount: 300, contentHash: "h1" } });
    const b = makePage({ url: "https://x.test/products/b", content: { text: "y", wordCount: 300, contentHash: "h2" } });
    const issues = nearDuplicateContentRule.evaluate(makeContext({ pages: [a, b] }), makeConfig())!;
    expect(issues).toHaveLength(0);
  });

  it("does not fire beyond the delta threshold", () => {
    const a = makePage({ url: "https://x.test/blog/a", content: { text: "x", wordCount: 100, contentHash: "h1" } });
    const b = makePage({ url: "https://x.test/blog/b", content: { text: "y", wordCount: 200, contentHash: "h2" } });
    const issues = nearDuplicateContentRule.evaluate(makeContext({ pages: [a, b] }), makeConfig())!;
    expect(issues).toHaveLength(0);
  });
});
