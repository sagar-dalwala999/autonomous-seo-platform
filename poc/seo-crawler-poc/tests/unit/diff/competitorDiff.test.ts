import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compareCompetitor } from "../../../src/diff/competitorDiff";
import { makeIssue, makePage, makeReport, writeRun } from "./fixtures";

describe("compareCompetitor", () => {
  let root: string;
  let oursDir: string;
  let theirsDir: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "c4-competitor-"));
    oursDir = path.join(root, "ours");
    theirsDir = path.join(root, "theirs");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("throws a clear error when a run directory doesn't exist", async () => {
    await writeRun(oursDir, "ours", [makePage()]);
    await expect(compareCompetitor(oursDir, path.join(root, "missing"))).rejects.toThrow(/run directory not found/);
  });

  it("never produces a page-level diff and always says so in notComparable", async () => {
    await writeRun(oursDir, "ours", [makePage({ url: "https://oursite.com/products/tent", normalizedUrl: "https://oursite.com/products/tent" })]);
    await writeRun(theirsDir, "theirs", [makePage({ url: "https://competitor.com/products/tent", normalizedUrl: "https://competitor.com/products/tent" })]);

    const cmp = await compareCompetitor(oursDir, theirsDir);
    expect(cmp).not.toHaveProperty("added");
    expect(cmp).not.toHaveProperty("removed");
    expect(cmp).not.toHaveProperty("changed");
    expect(cmp.notComparable.length).toBeGreaterThan(0);
    expect(cmp.notComparable.some((r) => r.toLowerCase().includes("page-level"))).toBe(true);
  });

  it("computes page-count-normalized health/issue metrics when both sides are analyzed", async () => {
    await writeRun(
      oursDir,
      "ours",
      [makePage(), makePage({ url: "https://oursite.com/b", normalizedUrl: "https://oursite.com/b" })],
      makeReport([makeIssue({ ruleId: "missing-title", url: "https://oursite.com/b" })], {
        healthScore: 90,
        pagesAnalyzed: 2,
        counts: { error: 0, warning: 1, notice: 0 },
      }),
    );
    await writeRun(
      theirsDir,
      "theirs",
      [makePage({ url: "https://competitor.com/", normalizedUrl: "https://competitor.com/" })],
      makeReport(
        [
          makeIssue({ ruleId: "missing-title", url: "https://competitor.com/" }),
          makeIssue({ ruleId: "thin-content", url: "https://competitor.com/", severity: "error" }),
        ],
        { healthScore: 60, pagesAnalyzed: 1, counts: { error: 1, warning: 1, notice: 0 } },
      ),
    );

    const cmp = await compareCompetitor(oursDir, theirsDir);
    const health = cmp.grid.find((m) => m.metric === "healthScore")!;
    expect(health.ours).toBe(90);
    expect(health.theirs).toBe(60);
    expect(health.delta).toBe(30);
    expect(health.comparable).toBe(true);

    const issuesPer100 = cmp.grid.find((m) => m.metric === "issuesPer100Pages")!;
    expect(issuesPer100.ours).toBe(50); // 1 issue / 2 pages * 100
    expect(issuesPer100.theirs).toBe(200); // 2 issues / 1 page * 100
  });

  it("reports healthScore as not comparable (never a fake zero) when one side lacks issues.json", async () => {
    await writeRun(oursDir, "ours", [makePage()]); // no issues.json
    await writeRun(theirsDir, "theirs", [makePage({ url: "https://competitor.com/" })], makeReport([], { healthScore: 100 }));

    const cmp = await compareCompetitor(oursDir, theirsDir);
    const health = cmp.grid.find((m) => m.metric === "healthScore")!;
    expect(health.ours).toBeNull();
    expect(health.theirs).toBe(100);
    expect(health.delta).toBeNull();
    expect(health.comparable).toBe(false);
  });

  it("computes structure and content metrics straight from crawled pages, no analysis required", async () => {
    await writeRun(oursDir, "ours", [
      makePage({ url: "https://oursite.com/", normalizedUrl: "https://oursite.com/", content: { text: "x", wordCount: 100, contentHash: "h1" }, crawl: { depth: 0, parentUrl: null, discoverySources: ["seed"] } }),
      makePage({ url: "https://oursite.com/deep", normalizedUrl: "https://oursite.com/deep", content: { text: "x", wordCount: 300, contentHash: "h2" }, crawl: { depth: 2, parentUrl: null, discoverySources: ["html-link"] } }),
    ]);
    await writeRun(theirsDir, "theirs", [
      makePage({ url: "https://competitor.com/", normalizedUrl: "https://competitor.com/", content: { text: "x", wordCount: 50, contentHash: "h3" }, crawl: { depth: 0, parentUrl: null, discoverySources: ["seed"] } }),
    ]);

    const cmp = await compareCompetitor(oursDir, theirsDir);
    const avgWords = cmp.grid.find((m) => m.metric === "avgWordCount")!;
    expect(avgWords.ours).toBe(200); // (100+300)/2
    expect(avgWords.theirs).toBe(50);
    expect(avgWords.comparable).toBe(true);

    const avgDepth = cmp.grid.find((m) => m.metric === "avgPageDepth")!;
    expect(avgDepth.ours).toBe(1); // (0+2)/2
    expect(avgDepth.theirs).toBe(0);
  });

  it("computes structured-data type coverage only when captured, and skips it (with a reason) otherwise", async () => {
    await writeRun(oursDir, "ours", [
      makePage({
        url: "https://oursite.com/",
        normalizedUrl: "https://oursite.com/",
        structuredDataReport: { items: [], counts: { jsonLdBlocks: 0, jsonLdParseErrors: 0, items: 0, jsonLdItems: 0, microdataItems: 0, rdfaItems: 0, validatedItems: 0, itemsMissingRequired: 0, unknownTypes: 0 }, errors: [], types: ["Product", "BreadcrumbList"], truncated: false },
      }),
    ]);
    await writeRun(theirsDir, "theirs", [
      makePage({
        url: "https://competitor.com/",
        normalizedUrl: "https://competitor.com/",
        structuredDataReport: { items: [], counts: { jsonLdBlocks: 0, jsonLdParseErrors: 0, items: 0, jsonLdItems: 0, microdataItems: 0, rdfaItems: 0, validatedItems: 0, itemsMissingRequired: 0, unknownTypes: 0 }, errors: [], types: ["Product"], truncated: false },
      }),
    ]);

    const cmp = await compareCompetitor(oursDir, theirsDir);
    expect(cmp.structuredDataCoverage).toHaveLength(2); // BreadcrumbList, Product
    const product = cmp.structuredDataCoverage.find((r) => r.type === "Product")!;
    expect(product.ourPages).toBe(1);
    expect(product.theirPages).toBe(1);
    const breadcrumb = cmp.structuredDataCoverage.find((r) => r.type === "BreadcrumbList")!;
    expect(breadcrumb.ourPages).toBe(1);
    expect(breadcrumb.theirPages).toBe(0);
  });

  it("skips structured-data coverage entirely and explains why when neither run captured it", async () => {
    await writeRun(oursDir, "ours", [makePage()]);
    await writeRun(theirsDir, "theirs", [makePage({ url: "https://competitor.com/" })]);

    const cmp = await compareCompetitor(oursDir, theirsDir);
    expect(cmp.structuredDataCoverage).toEqual([]);
    expect(cmp.notComparable.some((r) => r.includes("Structured-data type coverage"))).toBe(true);
  });

  it("is deterministic — identical input produces identical output on repeat runs", async () => {
    await writeRun(oursDir, "ours", [makePage()]);
    await writeRun(theirsDir, "theirs", [makePage({ url: "https://competitor.com/" })]);

    const first = await compareCompetitor(oursDir, theirsDir);
    const second = await compareCompetitor(oursDir, theirsDir);
    expect({ ...first, generatedAt: "x" }).toEqual({ ...second, generatedAt: "x" });
  });
});
