import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AnalysisReport, CrawledPage, Issue } from "../../../src/models/types";
import { RunStore } from "../../../src/storage/runStore";

export function makePage(overrides: Partial<CrawledPage> = {}): CrawledPage {
  return {
    runId: "run-1",
    url: "https://ex.com/",
    normalizedUrl: "https://ex.com/",
    finalUrl: "https://ex.com/",
    statusCode: 200,
    redirectChain: [],
    headers: {},
    performance: { responseTimeMs: 100 },
    renderedWith: "http",
    renderSignals: [],
    fetchedAt: "2026-01-01T00:00:00.000Z",
    crawl: { depth: 0, parentUrl: null, discoverySources: ["seed"] },
    title: "Title",
    metaDescription: "Desc",
    canonical: null,
    robots: { meta: [], noindex: false, nofollow: false },
    headings: { h1: ["H1"], h2: [], h3: [] },
    links: [],
    images: [],
    videos: [],
    structuredData: [],
    content: { text: "hello world", wordCount: 2, contentHash: "hash-a" },
    ...overrides,
  };
}

export function makeIssue(overrides: Partial<Issue> & { ruleId: string; url: string | null }): Issue {
  return {
    category: "test",
    severity: "warning",
    scope: "page",
    pageId: null,
    message: "test issue",
    howToFix: "fix it",
    evidence: [],
    ...overrides,
  };
}

export function makeReport(issues: Issue[], overrides: Partial<AnalysisReport> = {}): AnalysisReport {
  return {
    runId: "run",
    generatedAt: "2026-01-01T00:00:00.000Z",
    rulebookVersion: "test",
    configSnapshot: {},
    healthScore: 100,
    pagesAnalyzed: issues.length,
    counts: { error: 0, warning: 0, notice: 0 },
    rulesRun: 1,
    rulesSkippedDataUnavailable: [],
    issues,
    ...overrides,
  };
}

/** Writes a fake run directory (pages/<pageId>.json + report.json + optional issues.json) —
 * enough for diffRuns to read without going through the real crawler/analyzer. */
export async function writeRun(runDir: string, runId: string, pages: CrawledPage[], issues?: AnalysisReport): Promise<void> {
  const pagesDir = path.join(runDir, "pages");
  await mkdir(pagesDir, { recursive: true });
  for (const page of pages) {
    const pageId = RunStore.pageIdFor(page.normalizedUrl);
    await writeFile(path.join(pagesDir, `${pageId}.json`), JSON.stringify(page), "utf8");
  }
  await writeFile(path.join(runDir, "report.json"), JSON.stringify({ runId }), "utf8");
  if (issues) await writeFile(path.join(runDir, "issues.json"), JSON.stringify(issues), "utf8");
}
