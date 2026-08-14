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

  it("deducts score transparently for an error-severity check failing on every page it could read", () => {
    const res = computeHealthScoreDetail(spread("rule-0", 25), evaluated(40, 25), new Map(), configWith());
    expect(res.score).toBeLessThan(100);
    expect(res.score).toBeGreaterThan(0);
  });

  it("saturates instead of pinning to 0 — two catastrophic sites still rank against each other", () => {
    const tenRules = Array.from({ length: 10 }, (_, r) => spread(`rule-${r}`, 5)).flat();
    const twentyRules = Array.from({ length: 20 }, (_, r) => spread(`rule-${r}`, 5)).flat();
    const worse = score(twentyRules, 20, 5);
    const bad = score(tenRules, 20, 5);
    expect(worse).toBeGreaterThanOrEqual(0);
    expect(worse).toBeLessThanOrEqual(bad);
  });

  it("does not depend on how many pages were crawled", () => {
    // Same proportion of pages affected by the same check => same score at any site size.
    const small = score([issue("rule-0", "p0"), issue("rule-0", "p1")], 10, 10);
    const large = score(spread("rule-0", 200), 10, 1000);
    expect(small).toBe(large);
  });

  it("survives templated errors on every page without crashing", () => {
    const s = score(spread("rule-0", 25), 48, 25);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(100);
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
    expect(detail.score).toBeLessThan(100);
  });

  it("returns 100 rather than dividing by zero on an empty run", () => {
    expect(computeHealthScore([], new Map(), new Map(), configWith())).toBe(100);
    expect(score([], 0, 0)).toBe(100);
    expect(score([], 10, 0)).toBe(100);
  });

  it("returns 100 when every rule was skipped, even with findings on record", () => {
    const allSkipped = evaluated(10, 0);
    expect(computeHealthScore(spread("rule-0", 5), allSkipped, new Map(), configWith())).toBe(100);
  });

  it("never leaves the 0-100 range", () => {
    const brutal = Array.from({ length: 20 }, (_, r) => spread(`rule-${r}`, 10)).flat();
    const s = score(brutal, 5, 10);
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

  it("explains itself: contributions are damage-ordered and sum to totalDamage", () => {
    const issues = [...spread("rule-0", 10), ...spread("rule-1", 10, "warning"), ...spread("rule-2", 10, "notice")];
    const detail = computeHealthScoreDetail(issues, evaluated(5, 10), new Map(), configWith());
    expect(detail.contributions.map((c) => c.ruleId)).toEqual(["rule-0", "rule-1", "rule-2"]);
    expect(detail.contributions.reduce((s, c) => s + c.damage, 0)).toBeCloseTo(detail.totalDamage, 5);
    expect(detail.contributions[0]).toMatchObject({ severity: "error", affectedPages: 10, evaluatedPages: 10, reach: 1 });
  });
});
