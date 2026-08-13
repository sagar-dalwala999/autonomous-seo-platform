import { describe, expect, it } from "vitest";
import { buildRuleStatusDetail, computeFindings, priorityFor, SEVERITY_WEIGHT } from "../../../../src/analysis/priority/priority";
import type { Issue, RuleMeta } from "../../../../src/models/types";
import type { MuteRecord, PageImportanceResult } from "../../../../src/analysis/priority/types";

function issue(overrides: Partial<Issue> & { ruleId: string }): Issue {
  return {
    category: "test",
    severity: "warning",
    scope: "page",
    url: "https://ex.com/a",
    pageId: "pA",
    message: "m",
    howToFix: "fix",
    evidence: [],
    ...overrides,
  };
}

function meta(overrides: Partial<RuleMeta> & { id: string }): RuleMeta {
  return { category: "test", defaultSeverity: "warning", description: "why it matters", howToFix: "fix it", dataRequirements: [], ...overrides };
}

describe("priorityFor", () => {
  it("multiplies all four factors and rounds to an integer 0-100", () => {
    const r = priorityFor({ severity: "error", scope: "page", affectedPages: 100, evaluatedPages: 100, importance: 1, confidence: 1 });
    // reach = sqrt(1) = 1; 100 * 1(sev) * 1(reach) * 1(importance) * 1(confidence) = 100
    expect(r.priority).toBe(100);
    expect(r.factors).toEqual({ severity: 1, reach: 1, importance: 1, confidence: 1 });
  });

  it("site-scope reach is always 1 regardless of affected/evaluated", () => {
    const r = priorityFor({ severity: "notice", scope: "site", affectedPages: 3, evaluatedPages: 1000, importance: 0.5, confidence: 0.9 });
    expect(r.reach).toBe(1);
  });

  it("reach is square-rooted so one page of many still registers", () => {
    const r = priorityFor({ severity: "error", scope: "page", affectedPages: 1, evaluatedPages: 500, importance: 1, confidence: 1 });
    expect(r.reach).toBeCloseTo(Math.sqrt(1 / 500), 6);
    expect(r.priority).toBeGreaterThan(0); // never rounds away to nothing
  });

  it("SEVERITY_WEIGHT ranks error > warning > notice, our highest tier standing in for Kishan's critical", () => {
    expect(SEVERITY_WEIGHT.error).toBeGreaterThan(SEVERITY_WEIGHT.warning);
    expect(SEVERITY_WEIGHT.warning).toBeGreaterThan(SEVERITY_WEIGHT.notice);
    expect(SEVERITY_WEIGHT.error).toBe(1);
  });

  it("a lower-severity finding with full reach can still outrank a higher-severity finding buried on one unimportant page", () => {
    const buried = priorityFor({ severity: "error", scope: "page", affectedPages: 1, evaluatedPages: 1000, importance: 0.2, confidence: 1 });
    const everywhere = priorityFor({ severity: "notice", scope: "page", affectedPages: 1000, evaluatedPages: 1000, importance: 0.9, confidence: 1 });
    expect(everywhere.priority).toBeGreaterThan(buried.priority);
  });
});

const noImportance = new Map<string, PageImportanceResult>();
const noMutes = new Map<string, MuteRecord>();
const noErrors = new Set<string>();

describe("computeFindings", () => {
  it("exposes all four priority factors, decomposably, on a failing finding", () => {
    const findings = computeFindings({
      issues: [issue({ ruleId: "r1", severity: "error", pageId: "pA" })],
      ruleMetaById: new Map([["r1", meta({ id: "r1" })]]),
      evaluatedPagesByRule: new Map([["r1", 10]]),
      urlToPageId: new Map(),
      pagesAnalyzed: 10,
      importanceIndex: new Map([["pA", { pageId: "pA", score: 0.8, source: "pagerank", components: { rank: 80, depth: 1, inlinks: 1, sitemap: 1 } }]]),
      meanImportance: 0.5,
      damageByRule: new Map([["r1", 3.16]]),
      mutes: noMutes,
      erroredRuleIds: noErrors,
    });
    const f = findings.find((x) => x.ruleId === "r1")!;
    expect(f.status).toBe("failing");
    expect(f.priorityFactors).not.toBeNull();
    expect(f.priorityFactors).toEqual(expect.objectContaining({ severity: expect.any(Number), reach: expect.any(Number), importance: expect.any(Number), confidence: expect.any(Number) }));
    expect(f.priority).toBeGreaterThan(0);
    expect(f.damage).toBe(3.16);
    expect(f.why).toBe("why it matters"); // RuleMeta.description, no new field needed
  });

  it("a rule that ran clean (evaluated pages, zero hits) is status passed with priority 0", () => {
    const findings = computeFindings({
      issues: [],
      ruleMetaById: new Map([["clean-rule", meta({ id: "clean-rule" })]]),
      evaluatedPagesByRule: new Map([["clean-rule", 5]]),
      urlToPageId: new Map(),
      pagesAnalyzed: 5,
      importanceIndex: noImportance,
      meanImportance: 0.5,
      damageByRule: new Map(),
      mutes: noMutes,
      erroredRuleIds: noErrors,
    });
    const f = findings.find((x) => x.ruleId === "clean-rule")!;
    expect(f.status).toBe("passed");
    expect(f.priority).toBe(0);
    expect(f.priorityFactors).toBeNull();
  });

  it("a rule that never evaluated any page is status skipped-data-unavailable", () => {
    const findings = computeFindings({
      issues: [],
      ruleMetaById: new Map([["blind-rule", meta({ id: "blind-rule" })]]),
      evaluatedPagesByRule: new Map([["blind-rule", 0]]),
      urlToPageId: new Map(),
      pagesAnalyzed: 5,
      importanceIndex: noImportance,
      meanImportance: 0.5,
      damageByRule: new Map(),
      mutes: noMutes,
      erroredRuleIds: noErrors,
    });
    expect(findings.find((x) => x.ruleId === "blind-rule")!.status).toBe("skipped-data-unavailable");
  });

  it("a rule that threw on every page is status errored, not skipped", () => {
    const findings = computeFindings({
      issues: [],
      ruleMetaById: new Map([["crashy-rule", meta({ id: "crashy-rule" })]]),
      evaluatedPagesByRule: new Map([["crashy-rule", 0]]),
      urlToPageId: new Map(),
      pagesAnalyzed: 5,
      importanceIndex: noImportance,
      meanImportance: 0.5,
      damageByRule: new Map(),
      mutes: noMutes,
      erroredRuleIds: new Set(["crashy-rule"]),
    });
    expect(findings.find((x) => x.ruleId === "crashy-rule")!.status).toBe("errored");
  });

  it("a rule can be BOTH errored on some pages and failing on others — findings still land, status is failing", () => {
    const findings = computeFindings({
      issues: [issue({ ruleId: "partial-rule", pageId: "pA" })],
      ruleMetaById: new Map([["partial-rule", meta({ id: "partial-rule" })]]),
      evaluatedPagesByRule: new Map([["partial-rule", 3]]), // 3 of e.g. 5 pages evaluated ok
      urlToPageId: new Map(),
      pagesAnalyzed: 5,
      importanceIndex: noImportance,
      meanImportance: 0.5,
      damageByRule: new Map(),
      mutes: noMutes,
      erroredRuleIds: new Set(["partial-rule"]),
    });
    expect(findings.find((x) => x.ruleId === "partial-rule")!.status).toBe("failing");
  });

  it("a muted rule keeps running and keeps its priority number — status flips to muted, never deleted", () => {
    const mutes: Map<string, MuteRecord> = new Map([["muted-rule", { ruleId: "muted-rule", note: "known issue", mutedBy: null, mutedAt: "2026-01-01T00:00:00.000Z", expiresAt: null }]]);
    const findings = computeFindings({
      issues: [issue({ ruleId: "muted-rule", severity: "error", pageId: "pA" })],
      ruleMetaById: new Map([["muted-rule", meta({ id: "muted-rule" })]]),
      evaluatedPagesByRule: new Map([["muted-rule", 10]]),
      urlToPageId: new Map(),
      pagesAnalyzed: 10,
      importanceIndex: new Map([["pA", { pageId: "pA", score: 0.7, source: "pagerank", components: { rank: 70, depth: 1, inlinks: 1, sitemap: 1 } }]]),
      meanImportance: 0.5,
      damageByRule: new Map([["muted-rule", 5]]),
      mutes,
      erroredRuleIds: noErrors,
    });
    const f = findings.find((x) => x.ruleId === "muted-rule")!;
    expect(f.status).toBe("muted");
    expect(f.mutedNote).toBe("known issue");
    expect(f.priority).toBeGreaterThan(0); // still computed — never deleted
    expect(f.affectedPages).toBe(1); // it still "ran" and still counts
  });

  it("reuses automation/confidence/effort from the real automation registry for a known rule id, never re-deriving", () => {
    const findings = computeFindings({
      issues: [issue({ ruleId: "canonical-absent", severity: "notice", pageId: "pA" })], // real, auto-safe, observed (confidence 1)
      ruleMetaById: new Map([["canonical-absent", meta({ id: "canonical-absent", category: "indexability" })]]),
      evaluatedPagesByRule: new Map([["canonical-absent", 4]]),
      urlToPageId: new Map(),
      pagesAnalyzed: 4,
      importanceIndex: new Map([["pA", { pageId: "pA", score: 0.6, source: "pagerank", components: { rank: 60, depth: 1, inlinks: 1, sitemap: 1 } }]]),
      meanImportance: 0.5,
      damageByRule: new Map(),
      mutes: noMutes,
      erroredRuleIds: noErrors,
    });
    const f = findings.find((x) => x.ruleId === "canonical-absent")!;
    expect(f.automation).toBe("auto-safe");
    expect(f.detectionTier).toBe("observed");
    expect(f.confidence).toBe(1);
    expect(f.automationReviewed).toBe(true);
    expect(f.effort).toBe("low"); // auto-safe is always low effort
  });

  it("site-scope importance is the crawl's own mean importance, not the affected pages' mean (real site-scope rule: duplicate-title)", () => {
    const findings = computeFindings({
      issues: [issue({ ruleId: "duplicate-title", scope: "site", pageId: null, url: null })],
      ruleMetaById: new Map([["duplicate-title", meta({ id: "duplicate-title" })]]),
      evaluatedPagesByRule: new Map([["duplicate-title", 20]]),
      urlToPageId: new Map(),
      pagesAnalyzed: 20,
      // deliberately empty/irrelevant per-page importance — a site rule must ignore it and use meanImportance
      importanceIndex: new Map([["some-other-page", { pageId: "some-other-page", score: 0.05, source: "pagerank", components: { rank: 5, depth: 3, inlinks: 1, sitemap: 1 } }]]),
      meanImportance: 0.42,
      damageByRule: new Map(),
      mutes: noMutes,
      erroredRuleIds: noErrors,
    });
    const f = findings.find((x) => x.ruleId === "duplicate-title")!;
    expect(f.scope).toBe("site");
    expect(f.importance).toBeCloseTo(0.42, 10);
    expect(f.priorityFactors!.reach).toBe(1); // site scope always reaches 1
  });
});

describe("buildRuleStatusDetail", () => {
  it("carries {ruleId, pageCount, missing} for a skipped rule — missing is RuleMeta.dataRequirements", () => {
    const { skipped } = buildRuleStatusDetail({
      evaluatedPagesByRule: new Map([["needs-fonts", 0]]),
      ruleMetaById: new Map([["needs-fonts", meta({ id: "needs-fonts", dataRequirements: ["fonts"] })]]),
      erroredRuleInfo: new Map(),
      pagesAnalyzed: 12,
    });
    expect(skipped).toEqual([{ ruleId: "needs-fonts", category: "test", scope: "page", pageCount: 12, missing: ["fonts"] }]);
  });

  it("carries {ruleId, message, pageCount} for an errored rule, and never double-lists it as skipped", () => {
    const { skipped, errored } = buildRuleStatusDetail({
      evaluatedPagesByRule: new Map([["crashy", 0]]),
      ruleMetaById: new Map([["crashy", meta({ id: "crashy" })]]),
      erroredRuleInfo: new Map([["crashy", { message: "boom", pageCount: 3 }]]),
      pagesAnalyzed: 12,
    });
    expect(errored).toEqual([{ ruleId: "crashy", category: "test", scope: "page", message: "boom", pageCount: 3 }]);
    expect(skipped).toEqual([]);
  });
});
