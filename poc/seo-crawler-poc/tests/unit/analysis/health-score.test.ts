import { describe, it, expect } from "vitest";
import { computeHealthScore } from "../../../src/analysis/engine";
import type { Issue, IssueSeverity } from "../../../src/models/types";

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

const rules = (n: number) => new Set(Array.from({ length: n }, (_, i) => `rule-${i}`));
const score = (issues: Issue[], ruleCount: number, pages: number, skipped = new Set<string>()) =>
  computeHealthScore(issues, rules(ruleCount), skipped, pages, new Map());

describe("computeHealthScore", () => {
  it("scores 100 when every check passes", () => {
    expect(score([], 20, 50)).toBe(100);
  });

  it("scores 0 when every check fails at full coverage with errors", () => {
    const issues = Array.from({ length: 10 }, (_, r) =>
      Array.from({ length: 5 }, (_, p) => issue(`rule-${r}`, `p${p}`)),
    ).flat();
    expect(score(issues, 10, 5)).toBe(0);
  });

  it("does not depend on how many pages were crawled", () => {
    // Same proportion of pages affected by the same check => same score at any site size.
    const small = score([issue("rule-0", "p0"), issue("rule-0", "p1")], 10, 10);
    const large = score(
      Array.from({ length: 200 }, (_, p) => issue("rule-0", `p${p}`)),
      10,
      1000,
    );
    expect(small).toBe(large);
  });

  it("survives one templated error on every page — the failure that pinned the old model to 0", () => {
    const everywhere = Array.from({ length: 25 }, (_, p) => issue("rule-0", `p${p}`));
    const s = score(everywhere, 48, 25);
    expect(s).toBeGreaterThan(90); // 1 of 48 checks failing is not a dead site
    expect(s).toBeLessThan(100);
  });

  it("penalises breadth concavely: clearing one check beats halving two", () => {
    const pages = 100;
    const spread = (rule: string, n: number) => Array.from({ length: n }, (_, p) => issue(rule, `p${p}`));

    const baseline = [...spread("rule-0", 40), ...spread("rule-1", 40)];
    const clearedOne = [...spread("rule-1", 40)];
    const halvedBoth = [...spread("rule-0", 20), ...spread("rule-1", 20)];

    const base = score(baseline, 10, pages);
    expect(score(clearedOne, 10, pages)).toBeGreaterThan(score(halvedBoth, 10, pages));
    expect(score(clearedOne, 10, pages)).toBeGreaterThan(base);
  });

  it("weights severity: errors cost more than warnings, which cost more than notices", () => {
    const mk = (sev: IssueSeverity) => Array.from({ length: 10 }, (_, p) => issue("rule-0", `p${p}`, sev));
    const err = score(mk("error"), 10, 10);
    const warn = score(mk("warning"), 10, 10);
    const notice = score(mk("notice"), 10, 10);
    expect(err).toBeLessThan(warn);
    expect(warn).toBeLessThan(notice);
    expect(notice).toBeLessThan(100);
  });

  it("takes a rule's worst severity when it emits mixed severities", () => {
    const mixed = [issue("rule-0", "p0", "notice"), issue("rule-0", "p1", "error")];
    const allNotice = [issue("rule-0", "p0", "notice"), issue("rule-0", "p1", "notice")];
    expect(score(mixed, 10, 10)).toBeLessThan(score(allNotice, 10, 10));
  });

  it("excludes skipped checks from both sides rather than counting them as passes", () => {
    const issues = [issue("rule-0", "p0")];
    const withSkips = score(issues, 10, 10, new Set(["rule-5", "rule-6"]));
    const withoutSkips = score(issues, 8, 10);
    expect(withSkips).toBe(withoutSkips);
  });

  it("counts a site-scope finding that resolves to no page instead of scoring it free", () => {
    const unanchored: Issue = { ...issue("rule-0", "p0"), pageId: null, url: null };
    expect(score([unanchored], 10, 10)).toBeLessThan(100);
  });

  it("returns 100 rather than dividing by zero on an empty run", () => {
    expect(score([], 0, 0)).toBe(100);
    expect(score([], 10, 0)).toBe(100);
  });

  it("never leaves the 0-100 range", () => {
    const brutal = Array.from({ length: 20 }, (_, r) =>
      Array.from({ length: 10 }, (_, p) => issue(`rule-${r}`, `p${p}`)),
    ).flat();
    const s = score(brutal, 5, 10); // more failing rules than scored rules
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(100);
  });
});
