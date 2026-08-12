import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readIssues, writeIssues } from "../../../../src/analysis/store";
import type { AnalysisReport, Issue } from "../../../../src/models/types";

function issue(overrides: Partial<Issue> & { ruleId: string; severity: Issue["severity"]; url: string | null }): Issue {
  return {
    category: "test",
    scope: "site",
    pageId: null,
    message: "test issue",
    howToFix: "fix it",
    evidence: [],
    ...overrides,
  };
}

function report(issues: Issue[]): AnalysisReport {
  return {
    runId: "test-run",
    generatedAt: "2026-08-12T00:00:00.000Z",
    rulebookVersion: "test",
    configSnapshot: {},
    healthScore: 90,
    pagesAnalyzed: 3,
    counts: { error: 0, warning: 0, notice: 0 },
    rulesRun: 1,
    rulesSkippedDataUnavailable: [],
    issues,
  };
}

describe("store", () => {
  let runDir: string;

  beforeEach(async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "a4-store-"));
  });

  afterEach(async () => {
    await rm(runDir, { recursive: true, force: true });
  });

  it("readIssues returns null when never analyzed", async () => {
    expect(await readIssues(runDir)).toBeNull();
  });

  it("round-trips a report through issues.json", async () => {
    const r = report([issue({ ruleId: "orphan-page", severity: "warning", url: "https://x.test/a" })]);
    await writeIssues(runDir, r);
    const readBack = await readIssues(runDir);
    expect(readBack).not.toBeNull();
    expect(readBack!.issues).toHaveLength(1);
    expect(readBack!.runId).toBe("test-run");
  });

  it("writes issues sorted by severity -> ruleId -> url", async () => {
    const r = report([
      issue({ ruleId: "z-rule", severity: "notice", url: "https://x.test/b" }),
      issue({ ruleId: "a-rule", severity: "error", url: "https://x.test/z" }),
      issue({ ruleId: "a-rule", severity: "error", url: "https://x.test/a" }),
      issue({ ruleId: "m-rule", severity: "warning", url: null }),
    ]);
    await writeIssues(runDir, r);
    const readBack = await readIssues(runDir);
    const ordered = readBack!.issues.map((i) => `${i.severity}:${i.ruleId}:${i.url}`);
    expect(ordered).toEqual([
      "error:a-rule:https://x.test/a",
      "error:a-rule:https://x.test/z",
      "warning:m-rule:null",
      "notice:z-rule:https://x.test/b",
    ]);
  });
});
