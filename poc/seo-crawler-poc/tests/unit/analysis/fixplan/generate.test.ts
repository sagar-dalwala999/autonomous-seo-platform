import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateFixPlan } from "../../../../src/analysis/fixplan/generate";
import type { AnalysisReport, CrawledPage } from "../../../../src/models/types";

function makePage(overrides: Partial<CrawledPage> = {}): CrawledPage {
  return {
    runId: "test-run",
    url: "https://x.test/a",
    normalizedUrl: "https://x.test/a",
    finalUrl: "https://x.test/a",
    statusCode: 200,
    redirectChain: [],
    headers: {},
    performance: { responseTimeMs: 1 },
    renderedWith: "http",
    renderSignals: [],
    fetchedAt: "2026-01-01T00:00:00.000Z",
    crawl: { depth: 1, parentUrl: null, discoverySources: ["seed"] },
    title: "t",
    metaDescription: "d",
    canonical: null,
    robots: { meta: [], noindex: false, nofollow: false },
    headings: { h1: [], h2: [], h3: [] },
    links: [],
    images: [],
    videos: [],
    structuredData: [],
    content: { text: "", wordCount: 0, contentHash: "hash" },
    ...overrides,
  };
}

let runDir: string;

beforeEach(async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "fixplan-test-"));
  runDir = base;
  await mkdir(path.join(runDir, "pages"), { recursive: true });
});

afterEach(async () => {
  await rm(runDir, { recursive: true, force: true });
});

async function writeIssuesFixture(analysis: AnalysisReport): Promise<void> {
  await writeFile(path.join(runDir, "issues.json"), JSON.stringify(analysis, null, 2), "utf8");
}

describe("generateFixPlan", () => {
  it("throws a clear error when issues.json is missing", async () => {
    await expect(generateFixPlan(runDir)).rejects.toThrow(/issues\.json/);
  });

  it("always states applied: false, and only includes auto-safe findings", async () => {
    const page = makePage({ url: "https://x.test/a", finalUrl: "https://x.test/a", normalizedUrl: "https://x.test/a" });
    await writeFile(path.join(runDir, "pages", "p1.json"), JSON.stringify(page), "utf8");

    await writeIssuesFixture({
      runId: "test-run",
      generatedAt: "2026-01-01T00:00:00.000Z",
      rulebookVersion: "1.0.0",
      configSnapshot: {},
      healthScore: 50,
      pagesAnalyzed: 1,
      counts: { error: 0, warning: 0, notice: 2 },
      rulesRun: 2,
      rulesSkippedDataUnavailable: [],
      issues: [
        {
          ruleId: "canonical-absent",
          category: "indexability",
          severity: "notice",
          scope: "page",
          url: "https://x.test/a",
          pageId: "p1",
          message: "no canonical",
          howToFix: "add one",
          evidence: [{ field: "canonical", value: null }],
        },
        {
          // human-only rule — must NOT appear in the plan.
          ruleId: "title-missing",
          category: "on-page",
          severity: "error",
          scope: "page",
          url: "https://x.test/a",
          pageId: "p1",
          message: "no title",
          howToFix: "write one",
          evidence: [],
        },
      ],
    });

    const plan = await generateFixPlan(runDir);
    expect(plan.applied).toBe(false);
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]!.rule).toBe("canonical-absent");
    expect(plan.items[0]!.change).toContain("https://x.test/a");
    expect(plan.rules.map((r) => r.id)).toEqual(["canonical-absent"]);
    // title-missing (human-only) never shows up anywhere in the plan.
    expect(JSON.stringify(plan)).not.toContain("title-missing");
  });

  it("caps items at 500 and still reports the true totalChanges", async () => {
    const issues = Array.from({ length: 600 }, (_, i) => ({
      ruleId: "redirect-chain",
      category: "redirects",
      severity: "warning" as const,
      scope: "site" as const,
      url: `https://x.test/r${i}`,
      pageId: null,
      message: "chain",
      howToFix: "shorten it",
      evidence: [
        {
          field: "redirectChain",
          value: [
            { from: `https://x.test/r${i}`, to: `https://x.test/mid${i}`, statusCode: 301 },
            { from: `https://x.test/mid${i}`, to: `https://x.test/final${i}`, statusCode: 301 },
          ],
        },
      ],
    }));

    await writeIssuesFixture({
      runId: "test-run",
      generatedAt: "2026-01-01T00:00:00.000Z",
      rulebookVersion: "1.0.0",
      configSnapshot: {},
      healthScore: 50,
      pagesAnalyzed: 600,
      counts: { error: 0, warning: 600, notice: 0 },
      rulesRun: 1,
      rulesSkippedDataUnavailable: [],
      issues,
    });

    const plan = await generateFixPlan(runDir);
    expect(plan.totalChanges).toBe(600);
    expect(plan.items.length).toBe(500);
  });
});
