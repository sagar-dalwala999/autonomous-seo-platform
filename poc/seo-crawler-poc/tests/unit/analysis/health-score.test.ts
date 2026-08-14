import { describe, it, expect } from "vitest";
import { computeHealthScore, computeHealthScoreDetail } from "../../../src/analysis/engine";
import type { AnalysisConfig } from "../../../src/analysis/config";
import type { Issue, IssueSeverity } from "../../../src/models/types";
import { makeConfig } from "./page/testConfig";

function issue(ruleId: string, pageId: string, severity: IssueSeverity = "error"): Issue {
  return {
    ruleId,
    category: "links",
    severity,
    scope: "page",
    url: `https://x.test/${pageId}`,
    pageId,
    message: "m",
    howToFix: "f",
    evidence: [],
  } as Issue;
}

/** Weights live under thresholds, which the typed config does not declare — see healthWeights. */
function configWith(weights: Record<string, number> = {}): AnalysisConfig {
  const base = makeConfig();
  return { ...base, thresholds: { ...base.thresholds, ...weights } as AnalysisConfig["thresholds"] };
}

/** Every rule evaluated `pages` pages unless overridden — the common shape. */
function evaluated(ruleCount: number, pages: number, overrides: Record<string, number> = {}): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < ruleCount; i++) map.set(`rule-${i}`, pages);
  for (const [ruleId, n] of Object.entries(overrides)) map.set(ruleId, n);
  return map;
}

const score = (issues: Issue[], ruleCount: number, pages: number, overrides: Record<string, number> = {}) =>
  computeHealthScore(issues, evaluated(ruleCount, pages, overrides), new Map(), configWith());

const spread = (ruleId: string, n: number, severity: IssueSeverity = "error") =>
  Array.from({ length: n }, (_, p) => issue(ruleId, `p${p}`, severity));

describe("computeHealthScore", () => {
  it("scores 100 when every check passes", () => {
    expect(score([], 20, 50)).toBe(100);
  });

  it("halves the score for one error-severity check failing on every page it could read", () => {
    // The documented calibration anchor: halfScoreDamage == healthErrorWeight.
    expect(score(spread("rule-0", 25), 40, 25)).toBe(50);
  });

  it("saturates instead of pinning to 0 — two catastrophic sites still rank against each other", () => {
    const tenRules = Array.from({ length: 10 }, (_, r) => spread(`rule-${r}`, 5)).flat();
    const twentyRules = Array.from({ length: 20 }, (_, r) => spread(`rule-${r}`, 5)).flat();
    const worse = score(twentyRules, 20, 5);
    const bad = score(tenRules, 20, 5);
    expect(worse).toBeGreaterThan(0);
    expect(worse).toBeLessThan(bad);
    expect(bad).toBeLessThan(15);
  });

  it("does not depend on how many pages were crawled", () => {
    // Same proportion of pages affected by the same check => same score at any site size.
    const small = score([issue("rule-0", "p0"), issue("rule-0", "p1")], 10, 10);
    const large = score(spread("rule-0", 200), 10, 1000);
    expect(small).toBe(large);
  });

  it("does not depend on how many checks the site passes", () => {
    // The 88.8 bug: adding clean checks to the rulebook used to raise the score for free.
    const issues = spread("rule-0", 10);
    expect(score(issues, 10, 10)).toBe(score(issues, 60, 10));
  });

  it("survives one templated error on every page — the failure that pinned the pre-1.0 model to 0", () => {
    const s = score(spread("rule-0", 25), 48, 25);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(100);
  });

  it("penalises breadth concavely: clearing one check beats halving two", () => {
    const pages = 100;
    const baseline = [...spread("rule-0", 40), ...spread("rule-1", 40)];
    const clearedOne = [...spread("rule-1", 40)];
    const halvedBoth = [...spread("rule-0", 20), ...spread("rule-1", 20)];

    const base = score(baseline, 10, pages);
    expect(score(clearedOne, 10, pages)).toBeGreaterThan(score(halvedBoth, 10, pages));
    expect(score(clearedOne, 10, pages)).toBeGreaterThan(base);
  });

  it("weights severity: errors cost more than warnings, which cost more than notices", () => {
    const mk = (sev: IssueSeverity) => spread("rule-0", 10, sev);
    const err = score(mk("error"), 10, 10);
    const warn = score(mk("warning"), 10, 10);
    const notice = score(mk("notice"), 10, 10);
    expect(err).toBeLessThan(warn);
    expect(warn).toBeLessThan(notice);
    expect(notice).toBeLessThan(100);
  });

  it("lets a handful of errors outweigh a flood of notices", () => {
    // The shape of the miscalibrated run: 5 error rules on 1 page each vs 6 notice rules on all 25.
    const errors = Array.from({ length: 5 }, (_, r) => issue(`rule-${r}`, "p0"));
    const notices = Array.from({ length: 6 }, (_, r) => spread(`rule-${r + 5}`, 25, "notice")).flat();
    const detail = computeHealthScoreDetail(
      [...errors, ...notices],
      evaluated(20, 25),
      new Map(),
      configWith(),
    );
    const damageOf = (sev: IssueSeverity) =>
      detail.contributions.filter((c) => c.severity === sev).reduce((sum, c) => sum + c.damage, 0);
    expect(damageOf("error")).toBeGreaterThan(damageOf("notice"));
    expect(score([...errors, ...notices], 20, 25)).toBeLessThan(score(notices, 20, 25));
  });

  it("takes a rule's worst severity when it emits mixed severities", () => {
    const mixed = [issue("rule-0", "p0", "notice"), issue("rule-0", "p1", "error")];
    const allNotice = [issue("rule-0", "p0", "notice"), issue("rule-0", "p1", "notice")];
    expect(score(mixed, 10, 10)).toBeLessThan(score(allNotice, 10, 10));
  });

  it("still scores a rule that could only read some pages, instead of dropping its penalty", () => {
    // Cause 1: one null evaluation used to remove the rule AND every finding it produced.
    const partial = score(spread("rule-0", 3), 10, 10, { "rule-0": 3 });
    expect(partial).toBeLessThan(100);
    expect(score([], 10, 10, { "rule-0": 3 })).toBe(100); // partial data, nothing found => clean
  });

  it("measures reach against the pages a rule read, never counting unread pages as passes", () => {
    // Failing 3 of the 3 pages it could read is full reach, not 3/10.
    const readThree = score(spread("rule-0", 3), 10, 10, { "rule-0": 3 });
    const readAll = score(spread("rule-0", 10), 10, 10);
    expect(readThree).toBe(readAll);
  });

  it("excludes a rule that ran on zero pages, findings included", () => {
    const withDeadRule = computeHealthScoreDetail(
      [...spread("rule-0", 5), ...spread("rule-9", 5)],
      evaluated(10, 10, { "rule-9": 0 }),
      new Map(),
      configWith(),
    );
    const withoutDeadRule = computeHealthScoreDetail(spread("rule-0", 5), evaluated(10, 10), new Map(), configWith());
    expect(withDeadRule.score).toBe(withoutDeadRule.score);
    expect(withDeadRule.contributions.some((c) => c.ruleId === "rule-9")).toBe(false);
  });

  it("counts a site-scope finding that resolves to no page instead of scoring it free", () => {
    const unanchored: Issue = { ...issue("rule-0", "p0"), pageId: null, url: null };
    expect(score([unanchored], 10, 10)).toBeLessThan(100);
  });

  it("clamps reach at 1 when a site rule emits more findings than there are pages", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      ...issue("rule-0", "p0"),
      pageId: null,
      url: `https://x.test/uncrawled-${i}`,
    })) as Issue[];
    const detail = computeHealthScoreDetail(many, evaluated(10, 10), new Map(), configWith());
    expect(detail.contributions[0]?.reach).toBe(1);
    expect(detail.score).toBe(50);
  });

  it("returns 100 rather than dividing by zero on an empty run", () => {
    expect(computeHealthScore([], new Map(), new Map(), configWith())).toBe(100);
    expect(score([], 0, 0)).toBe(100);
    expect(score([], 10, 0)).toBe(100); // every rule blind => nothing to score
  });

  it("returns 100 when every rule was skipped, even with findings on record", () => {
    const allSkipped = evaluated(10, 0);
    expect(computeHealthScore(spread("rule-0", 5), allSkipped, new Map(), configWith())).toBe(100);
  });

  it("never leaves the 0-100 range", () => {
    const brutal = Array.from({ length: 20 }, (_, r) => spread(`rule-${r}`, 10)).flat();
    const s = score(brutal, 5, 10); // more failing rules than the map declares
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(100);
  });

  it("is deterministic: identical inputs and reordered findings give an identical score", () => {
    const issues = [...spread("rule-0", 7), ...spread("rule-1", 4, "warning"), ...spread("rule-2", 9, "notice")];
    const reversed = [...issues].reverse();
    const a = score(issues, 12, 20);
    expect(score(issues, 12, 20)).toBe(a);
    expect(score(reversed, 12, 20)).toBe(a);
  });

  it("reads its weights from config so they stay tunable without a code change", () => {
    const issues = spread("rule-0", 10, "notice");
    const strict = computeHealthScore(issues, evaluated(10, 10), new Map(), configWith({ healthNoticeWeight: 10 }));
    const lenient = computeHealthScore(issues, evaluated(10, 10), new Map(), configWith({ healthNoticeWeight: 1 }));
    expect(strict).toBe(50);
    expect(lenient).toBeGreaterThan(strict);

    const forgiving = computeHealthScore(issues, evaluated(10, 10), new Map(), configWith({ healthHalfScoreDamage: 100 }));
    expect(forgiving).toBeGreaterThan(lenient);
  });

  it("falls back to built-in weights when the config predates them", () => {
    const bare = makeConfig(); // no health* thresholds at all
    expect(computeHealthScore(spread("rule-0", 10), evaluated(10, 10), new Map(), bare)).toBe(50);
  });

  it("explains itself: contributions are damage-ordered and sum to the total", () => {
    const issues = [...spread("rule-0", 10), ...spread("rule-1", 10, "warning"), ...spread("rule-2", 10, "notice")];
    const detail = computeHealthScoreDetail(issues, evaluated(5, 10), new Map(), configWith());
    expect(detail.contributions.map((c) => c.ruleId)).toEqual(["rule-0", "rule-1", "rule-2"]);
    expect(detail.contributions.reduce((s, c) => s + c.damage, 0)).toBeCloseTo(detail.totalDamage, 10);
    expect(detail.contributions[0]).toMatchObject({ severity: "error", affectedPages: 10, evaluatedPages: 10, reach: 1 });
  });
});
