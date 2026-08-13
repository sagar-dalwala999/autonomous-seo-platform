import { describe, expect, it } from "vitest";
import { buildAutomationReport } from "../../../../src/analysis/automation/report";
import type { AnalysisReport, Issue } from "../../../../src/models/types";

function issue(overrides: Partial<Issue> & Pick<Issue, "ruleId" | "url" | "pageId">): Issue {
  return {
    category: "test",
    severity: "notice",
    scope: "page",
    message: "test issue",
    howToFix: "do the thing",
    evidence: [],
    ...overrides,
  };
}

function report(issues: Issue[], pagesAnalyzed = 10): AnalysisReport {
  return {
    runId: "test-run",
    generatedAt: "2026-01-01T00:00:00.000Z",
    rulebookVersion: "1.0.0",
    configSnapshot: {},
    healthScore: 50,
    pagesAnalyzed,
    counts: { error: 0, warning: 0, notice: issues.length },
    rulesRun: 1,
    rulesSkippedDataUnavailable: [],
    issues,
  };
}

describe("buildAutomationReport", () => {
  it("classifies a known auto-safe rule correctly and derives low effort", () => {
    const r = buildAutomationReport(
      report([
        issue({ ruleId: "canonical-absent", url: "https://x.test/a", pageId: "p1" }),
        issue({ ruleId: "canonical-absent", url: "https://x.test/b", pageId: "p2" }),
      ]),
    );
    const rule = r.rules.find((x) => x.ruleId === "canonical-absent")!;
    expect(rule.automation).toBe("auto-safe");
    expect(rule.reviewed).toBe(true);
    expect(rule.affectedPages).toBe(2);
    expect(rule.effort.level).toBe("low");
    expect(r.counts["auto-safe"]).toBeGreaterThanOrEqual(1);
  });

  it("dedupes affected pages by pageId, falling back to url, falling back to an unanchored bucket", () => {
    const r = buildAutomationReport(
      report([
        // same pageId twice (a rule that bundles multiple evidence items into one issue per page + a
        // duplicate) must count as ONE affected page, not two.
        issue({ ruleId: "thin-content", url: "https://x.test/a", pageId: "p1" }),
        issue({ ruleId: "thin-content", url: "https://x.test/a", pageId: "p1" }),
        // site-scope finding with no pageId falls back to url.
        issue({ ruleId: "thin-content", url: "https://x.test/b", pageId: null }),
      ]),
    );
    const rule = r.rules.find((x) => x.ruleId === "thin-content")!;
    expect(rule.affectedPages).toBe(2);
    expect(rule.instances).toBe(3);
  });

  it("falls back an unknown rule id to human-only and flags it unreviewed", () => {
    const r = buildAutomationReport(report([issue({ ruleId: "some-brand-new-rule-nobody-classified-yet", url: "https://x.test/a", pageId: "p1" })]));
    const rule = r.rules.find((x) => x.ruleId === "some-brand-new-rule-nobody-classified-yet")!;
    expect(rule.automation).toBe("human-only");
    expect(rule.reviewed).toBe(false);
    expect(r.unreviewedRuleIds).toContain("some-brand-new-rule-nobody-classified-yet");
  });

  it("counts sum to the number of distinct rules that fired", () => {
    const r = buildAutomationReport(
      report([
        issue({ ruleId: "canonical-absent", url: "https://x.test/a", pageId: "p1" }),
        issue({ ruleId: "mixed-content", url: "https://x.test/a", pageId: "p1" }),
        issue({ ruleId: "thin-content", url: "https://x.test/a", pageId: "p1" }),
      ]),
    );
    const total = r.counts["auto-safe"] + r.counts["auto-with-review"] + r.counts["human-only"];
    expect(total).toBe(r.rules.length);
    expect(r.rules.length).toBe(3);
  });
});
