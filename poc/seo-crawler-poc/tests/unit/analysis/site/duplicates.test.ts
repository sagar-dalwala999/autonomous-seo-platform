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

// Real extracted content.text (storage/runs/poc2-full) for the seeded manifest #18 near-dup pair —
// same fixture used by similarity.test.ts, measured ~0.859 estimated / ~0.824 true Jaccard (5-word
// shingles). Reused verbatim here so the rule-level test proves the same real-world pair the
// acceptance gate (scripts/analyzer-gate.ts #18) requires actually clusters end-to-end.
const WINTER_HIKING =
  "Winter hiking checklistWinter turns small mistakes into big ones. Daylight is short, wet is " +
  "dangerous, and a twisted ankle that means a boring wait in July can mean hypothermia in " +
  "January. We run this checklist before every cold-season hike, without exception, even on " +
  "trails we know well.ClothingNo cotton anywhere. A wicking base layer, an insulating mid " +
  "layer, and a waterproof shell, plus a spare insulation piece that stays dry in the pack " +
  "until you stop moving. Warm hat, liner gloves inside insulated gloves, and wool socks with " +
  "a dry spare pair.Traction and lightMicrospikes go in the pack from November to April whether " +
  "the trailhead is icy or not. Carry a headlamp with fresh batteries and keep a spare set warm " +
  "in an inside pocket — cold drains batteries far faster than summer hikers expect.Food, water, " +
  "and the turnaroundCold suppresses thirst, so drink on a schedule, and pack more calories than " +
  "a summer day needs. Set a hard turnaround time before you leave the car and honor it. The " +
  "summit is optional; the parking lot is mandatory.";

const WINTER_DAY_HIKE =
  "Winter day-hike checklistWinter turns small mistakes into big ones. Daylight is short, wet is " +
  "dangerous, and a twisted ankle that means a boring wait in July can mean hypothermia in " +
  "January. We run this checklist before every cold-season day hike, without exception, even on " +
  "trails we know well.ClothingNo cotton anywhere. A wicking base layer, an insulating mid " +
  "layer, and a waterproof shell, plus a spare insulation piece that stays dry in the pack " +
  "until you stop moving. Warm hat, liner gloves inside insulated gloves, and wool socks with " +
  "a dry spare pair.Traction and lightMicrospikes go in the pack from November to April whether " +
  "the trailhead is icy or not. Carry a headlamp with fresh batteries and keep a spare set warm " +
  "in an inside pocket — cold drains batteries far faster than summer hikers expect.Food, water, " +
  "and the turnaroundCold suppresses thirst, so drink on a schedule, and pack more calories than " +
  "a summer outing needs. Set a hard turnaround time before you leave the trailhead and honor it. " +
  "The summit is optional; the parking lot is mandatory.";

function wordsOf(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** fixtures.ts's makeConfig() replaces `thresholds` wholesale on override (shallow spread), so a
 * nearDupSimilarity override needs every sibling threshold restated — kept in sync with fixtures.ts's
 * own defaults. */
function configWithSimilarity(nearDupSimilarity: number) {
  return makeConfig({
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
      nearDupSimilarity,
      weakInlinkCount: 1,
    },
  });
}

describe("nearDuplicateContentRule", () => {
  it("fires for the real seeded near-dup pair via real similarity, not word count", () => {
    const a = makePage({
      url: "https://x.test/blog/winter-hiking-checklist",
      content: { text: WINTER_HIKING, wordCount: wordsOf(WINTER_HIKING), contentHash: "hashA" },
    });
    const b = makePage({
      url: "https://x.test/blog/winter-day-hike-checklist",
      content: { text: WINTER_DAY_HIKE, wordCount: wordsOf(WINTER_DAY_HIKE), contentHash: "hashB" },
    });
    const issues = nearDuplicateContentRule.evaluate(makeContext({ pages: [a, b] }), makeConfig())!;
    expect(issues).toHaveLength(2);
    expect(issues.every((i) => i.severity === "notice")).toBe(true);
    expect(issues[0]!.threshold).toContain("Jaccard");
    expect(issues[0]!.message).toMatch(/~\d+% similar/);
    expect(issues[0]!.evidence.some((e) => e.pageId)).toBe(true);
  });

  it("does not fire for two pages with matching word count but unrelated content (the wordCount-proxy bug this slice fixes)", () => {
    const textA = Array.from({ length: 200 }, (_, i) => `alpha${i} mountain trail gear winter`).join(" ");
    const textB = Array.from({ length: 200 }, (_, i) => `zzz${i} finance quarterly revenue earnings`).join(" ");
    const a = makePage({ url: "https://x.test/blog/a", content: { text: textA, wordCount: wordsOf(textA), contentHash: "h1" } });
    const b = makePage({ url: "https://x.test/products/b", content: { text: textB, wordCount: wordsOf(textB), contentHash: "h2" } });
    const issues = nearDuplicateContentRule.evaluate(makeContext({ pages: [a, b] }), makeConfig())!;
    expect(issues).toHaveLength(0);
  });

  it("fires across different site sections — real similarity replaces the old proxy's section fence", () => {
    const a = makePage({
      url: "https://x.test/blog/winter-hiking-checklist",
      content: { text: WINTER_HIKING, wordCount: wordsOf(WINTER_HIKING), contentHash: "hashA" },
    });
    const b = makePage({
      url: "https://x.test/products/winter-day-hike-checklist",
      content: { text: WINTER_DAY_HIKE, wordCount: wordsOf(WINTER_DAY_HIKE), contentHash: "hashB" },
    });
    const issues = nearDuplicateContentRule.evaluate(makeContext({ pages: [a, b] }), makeConfig())!;
    expect(issues).toHaveLength(2); // fires regardless of path — content similarity, not URL prefix
  });

  it("excludes exact duplicates (identical contentHash) — exact-duplicate-content owns those", () => {
    const a = makePage({
      url: "https://x.test/a",
      content: { text: WINTER_HIKING, wordCount: wordsOf(WINTER_HIKING), contentHash: "same-hash" },
    });
    const aTwin = makePage({
      url: "https://x.test/a-copy",
      content: { text: WINTER_HIKING, wordCount: wordsOf(WINTER_HIKING), contentHash: "same-hash" },
    });
    const issues = nearDuplicateContentRule.evaluate(makeContext({ pages: [a, aTwin] }), makeConfig())!;
    expect(issues).toHaveLength(0);
  });

  it("respects a configured nearDupSimilarity threshold", () => {
    const a = makePage({
      url: "https://x.test/blog/winter-hiking-checklist",
      content: { text: WINTER_HIKING, wordCount: wordsOf(WINTER_HIKING), contentHash: "hashA" },
    });
    const b = makePage({
      url: "https://x.test/blog/winter-day-hike-checklist",
      content: { text: WINTER_DAY_HIKE, wordCount: wordsOf(WINTER_DAY_HIKE), contentHash: "hashB" },
    });
    // Measured similarity for this pair is ~0.86 — a threshold of 0.99 should un-cluster it.
    const issues = nearDuplicateContentRule.evaluate(makeContext({ pages: [a, b] }), configWithSimilarity(0.99))!;
    expect(issues).toHaveLength(0);
  });

  it("falls back to similarity.ts's default threshold gracefully when a config lacks nearDupSimilarity (old-config compatibility)", () => {
    const a = makePage({
      url: "https://x.test/blog/winter-hiking-checklist",
      content: { text: WINTER_HIKING, wordCount: wordsOf(WINTER_HIKING), contentHash: "hashA" },
    });
    const b = makePage({
      url: "https://x.test/blog/winter-day-hike-checklist",
      content: { text: WINTER_DAY_HIKE, wordCount: wordsOf(WINTER_DAY_HIKE), contentHash: "hashB" },
    });
    // makeConfig() here has no nearDupSimilarity key at all (fixtures.ts predates slice C3).
    const issues = nearDuplicateContentRule.evaluate(makeContext({ pages: [a, b] }), makeConfig())!;
    expect(issues).toHaveLength(2);
  });

  it("respects config severity override and enabled=false", () => {
    const a = makePage({
      url: "https://x.test/blog/winter-hiking-checklist",
      content: { text: WINTER_HIKING, wordCount: wordsOf(WINTER_HIKING), contentHash: "hashA" },
    });
    const b = makePage({
      url: "https://x.test/blog/winter-day-hike-checklist",
      content: { text: WINTER_DAY_HIKE, wordCount: wordsOf(WINTER_DAY_HIKE), contentHash: "hashB" },
    });
    const ctx = makeContext({ pages: [a, b] });
    const overridden = nearDuplicateContentRule.evaluate(ctx, makeConfig({ rules: { "near-duplicate-content": { severity: "warning" } } }))!;
    expect(overridden[0]!.severity).toBe("warning");
    const disabled = nearDuplicateContentRule.evaluate(ctx, makeConfig({ rules: { "near-duplicate-content": { enabled: false } } }));
    expect(disabled).toBeNull();
  });
});
