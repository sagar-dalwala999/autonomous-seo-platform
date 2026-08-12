import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAnalysis } from "../../../src/analysis/engine";
import type { CrawledPage } from "../../../src/models/types";
import { makePage } from "../report/fixtures";
import { makeConfig } from "./page/testConfig";

let runDir: string | undefined;

afterEach(async () => {
  if (runDir) await rm(runDir, { recursive: true, force: true });
  runDir = undefined;
});

async function makeRun(pages: Record<string, CrawledPage>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "a3-engine-"));
  runDir = dir;
  await mkdir(path.join(dir, "pages"), { recursive: true });
  for (const [pageId, page] of Object.entries(pages)) {
    await writeFile(path.join(dir, "pages", `${pageId}.json`), JSON.stringify(page));
  }
  return dir;
}

describe("runAnalysis", () => {
  it("sorts issues by severity -> ruleId -> url, deterministically across repeated runs", async () => {
    const dir = await makeRun({
      onepage: makePage({
        url: "http://ex.com/z",
        title: null, // title-missing: error
        headings: { h1: [], h2: [], h3: [] }, // h1-missing: warning
        canonical: null, // canonical-absent: notice
      }),
    });
    const config = makeConfig();
    const report = await runAnalysis(dir, config);
    const severities = report.issues.map((i) => i.severity);
    expect(severities[0]).toBe("error");
    expect(severities.indexOf("notice")).toBeGreaterThan(severities.indexOf("warning"));

    const report2 = await runAnalysis(dir, config);
    expect(report2.issues.map((i) => ({ ruleId: i.ruleId, severity: i.severity, url: i.url }))).toEqual(
      report.issues.map((i) => ({ ruleId: i.ruleId, severity: i.severity, url: i.url })),
    );
  });

  it("computes healthScore = pages without error-severity issues / analyzed * 100, one decimal", async () => {
    const dir = await makeRun({
      clean1: makePage({ url: "http://ex.com/1", title: "A perfectly fine title, well within range", statusCode: 200 }),
      clean2: makePage({ url: "http://ex.com/2", title: "Another perfectly fine title, also fine", statusCode: 200 }),
      broken: makePage({ url: "http://ex.com/3", title: "A perfectly fine title too, also fine", statusCode: 404 }),
    });
    const report = await runAnalysis(dir, makeConfig());
    expect(report.pagesAnalyzed).toBe(3);
    expect(report.healthScore).toBeCloseTo(66.7, 1);
    expect(report.issues.some((i) => i.ruleId === "http-error-4xx" && i.url === "http://ex.com/3")).toBe(true);
  });

  it("degrades gracefully on pre-v2 pages: v2-gated rules skip (never false-fire), v1 rules still run", async () => {
    const fullPage = makePage({ url: "http://ex.com/old", title: null, statusCode: 200 });
    const { social, hreflang, metaRefresh, metaKeywords, pixelWidths, pageStats, titles, metaDescriptions, renderDivergence, ...oldPage } =
      fullPage;
    const dir = await makeRun({ old: oldPage });

    const report = await runAnalysis(dir, makeConfig());

    expect(report.rulesSkippedDataUnavailable).toEqual(
      expect.arrayContaining([
        "low-text-ratio",
        "og-missing",
        "twitter-missing",
        "security-headers-missing",
        "title-multiple",
        "meta-description-multiple",
        "meta-refresh-present",
      ]),
    );
    // v1-field rule still evaluates and fires despite the page lacking every v2 field.
    expect(report.issues.some((i) => i.ruleId === "title-missing" && i.url === "http://ex.com/old")).toBe(true);
  });

  it("tolerates a run directory missing failures/blocked/sitemaps/robots/report.json entirely", async () => {
    const dir = await makeRun({ p: makePage({ url: "http://ex.com/p" }) });
    await expect(runAnalysis(dir, makeConfig())).resolves.toBeDefined();
  });

  it("tolerates a run directory with no pages/ folder at all (zero pages analyzed)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "a3-engine-empty-"));
    runDir = dir;
    const report = await runAnalysis(dir, makeConfig());
    expect(report.pagesAnalyzed).toBe(0);
    expect(report.healthScore).toBe(100);
    expect(report.issues).toEqual([]);
  });
});
