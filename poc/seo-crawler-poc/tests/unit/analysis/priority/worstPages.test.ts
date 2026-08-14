import { describe, expect, it } from "vitest";
import { computeWorstPages } from "../../../../src/analysis/priority/worstPages";
import type { Issue } from "../../../../src/models/types";

function issue(overrides: Partial<Issue> & { ruleId: string; pageId: string }): Issue {
  return { category: "test", severity: "warning", scope: "page", url: `https://ex.com/${overrides.pageId}`, message: "m", howToFix: "fix", evidence: [], ...overrides };
}

describe("computeWorstPages", () => {
  it("ranks pages by aggregate weighted harm, worst first", () => {
    const issues: Issue[] = [
      issue({ ruleId: "title-missing", pageId: "worst", severity: "error" }),
      issue({ ruleId: "h1-missing", pageId: "worst", severity: "error" }),
      issue({ ruleId: "canonical-absent", pageId: "mild", severity: "notice" }),
    ];
    const list = computeWorstPages({
      issues,
      urlToPageId: new Map(),
      pageUrlById: new Map([["worst", "https://ex.com/worst"], ["mild", "https://ex.com/mild"]]),
      mutedRuleIds: new Set(),
    });
    expect(list[0]!.pageId).toBe("worst");
    expect(list[0]!.harm).toBeGreaterThan(list[1]!.harm);
    expect(list[0]!.issueCount).toBe(2);
  });

  it("excludes muted rules from the harm total", () => {
    const issues: Issue[] = [
      issue({ ruleId: "muted-rule", pageId: "p1", severity: "error" }),
      issue({ ruleId: "live-rule", pageId: "p1", severity: "notice" }),
    ];
    const withMute = computeWorstPages({ issues, urlToPageId: new Map(), pageUrlById: new Map(), mutedRuleIds: new Set(["muted-rule"]) });
    const withoutMute = computeWorstPages({ issues, urlToPageId: new Map(), pageUrlById: new Map(), mutedRuleIds: new Set() });
    expect(withMute[0]!.harm).toBeLessThan(withoutMute[0]!.harm);
    expect(withMute[0]!.issueCount).toBe(1);
  });

  it("ignores unanchored (site-scope, no pageId resolvable) issues — they can't attribute to one page", () => {
    const issues: Issue[] = [{ ruleId: "site-rule", category: "test", severity: "warning", scope: "site", url: null, pageId: null, message: "m", howToFix: "f", evidence: [] }];
    const list = computeWorstPages({ issues, urlToPageId: new Map(), pageUrlById: new Map(), mutedRuleIds: new Set() });
    expect(list).toEqual([]);
  });

  it("honors the top cap when given", () => {
    const issues: Issue[] = [
      issue({ ruleId: "r", pageId: "a" }),
      issue({ ruleId: "r", pageId: "b" }),
      issue({ ruleId: "r", pageId: "c" }),
    ];
    const list = computeWorstPages({ issues, urlToPageId: new Map(), pageUrlById: new Map(), mutedRuleIds: new Set(), top: 2 });
    expect(list.length).toBe(2);
  });

  it("resolves pageId via urlToPageId when the issue carries no direct pageId", () => {
    const issues: Issue[] = [{ ruleId: "r", category: "test", severity: "warning", scope: "page", url: "https://ex.com/x", pageId: null, message: "m", howToFix: "f", evidence: [] }];
    const list = computeWorstPages({ issues, urlToPageId: new Map([["https://ex.com/x", "pX"]]), pageUrlById: new Map([["pX", "https://ex.com/x"]]), mutedRuleIds: new Set() });
    expect(list[0]!.pageId).toBe("pX");
  });
});
