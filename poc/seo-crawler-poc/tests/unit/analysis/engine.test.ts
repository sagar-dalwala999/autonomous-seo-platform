import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAnalysis } from "../../../src/analysis/engine";
import { muteRule } from "../../../src/analysis/priority/muteStore";
import type { CrawledPage, CrawlSummary } from "../../../src/models/types";
import { makePage } from "../report/fixtures";
import { makeConfig } from "./page/testConfig";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function makeRun(pages: Record<string, CrawledPage>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "a3-engine-"));
  dirs.push(dir);
  await mkdir(path.join(dir, "pages"), { recursive: true });
  for (const [pageId, page] of Object.entries(pages)) {
    await writeFile(path.join(dir, "pages", `${pageId}.json`), JSON.stringify(page));
  }
  return dir;
}

/** "<storageRoot>/runs/<runId>" — the real production layout (see cli.ts), required for
 * ensureGraphReport-equivalent writes to land predictably and for mute-store resolution to
 * trust the derived storageRoot (engine.ts only trusts it when runDir's parent is "runs"). */
async function makeSiteRun(runId: string, pages: Record<string, CrawledPage>, startUrl: string): Promise<{ runDir: string; storageRoot: string }> {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "a3-engine-site-"));
  dirs.push(storageRoot);
  const runDir = path.join(storageRoot, "runs", runId);
  await mkdir(path.join(runDir, "pages"), { recursive: true });
  for (const [pageId, page] of Object.entries(pages)) {
    await writeFile(path.join(runDir, "pages", `${pageId}.json`), JSON.stringify(page));
  }
  const summary: Partial<CrawlSummary> = { runId, startUrl };
  await writeFile(path.join(runDir, "report.json"), JSON.stringify(summary));
  return { runDir, storageRoot };
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
    expect(report2.healthScore).toBe(report.healthScore);
  });

  // Was "pages without error-severity issues / analyzed", then check-averaged (which let a clean
  // rulebook dilute real errors). Now severity-weighted damage — see computeHealthScoreDetail.
  it("scores harm: adding a broken page lowers the score, and the score stays a bounded one-decimal number", async () => {
    const clean = {
      clean1: makePage({ url: "http://ex.com/1", title: "A perfectly fine title, well within range", statusCode: 200 }),
      clean2: makePage({ url: "http://ex.com/2", title: "Another perfectly fine title, also fine", statusCode: 200 }),
    };
    const healthy = await runAnalysis(await makeRun(clean), makeConfig());
    const broken = await runAnalysis(
      await makeRun({
        ...clean,
        broken: makePage({ url: "http://ex.com/3", title: "A perfectly fine title too, also fine", statusCode: 404 }),
      }),
      makeConfig(),
    );

    expect(broken.pagesAnalyzed).toBe(3);
    expect(broken.healthScore).toBeLessThan(healthy.healthScore);
    expect(broken.healthScore).toBeGreaterThan(0);
    expect(broken.healthScore).toBeLessThan(100);
    expect(broken.healthScore).toBe(Math.round(broken.healthScore * 10) / 10); // one decimal
    expect(broken.issues.some((i) => i.ruleId === "http-error-4xx" && i.url === "http://ex.com/3")).toBe(true);
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

  it("keeps a rule that could read only some pages: it still penalises and is not reported as skipped", async () => {
    const readable = makePage({ url: "http://ex.com/a" }); // social present but empty -> og-missing fires
    const { social: _dropped, ...unreadable } = makePage({ url: "http://ex.com/b" });

    const partial = await runAnalysis(await makeRun({ a: readable, b: unreadable as CrawledPage }), makeConfig());
    const noneReadable = await runAnalysis(
      await makeRun({ a: unreadable as CrawledPage, b: { ...(unreadable as CrawledPage), url: "http://ex.com/a" } }),
      makeConfig(),
    );

    expect(partial.issues.some((i) => i.ruleId === "og-missing" && i.url === "http://ex.com/a")).toBe(true);
    expect(partial.rulesSkippedDataUnavailable).not.toContain("og-missing");
    expect(noneReadable.rulesSkippedDataUnavailable).toContain("og-missing");
    // The finding the old model discarded along with the rule now costs something.
    expect(partial.healthScore).toBeLessThan(noneReadable.healthScore);
  });

  it("reports only rules that ran nowhere as skipped, and never a rule that produced findings", async () => {
    const dir = await makeRun({ p: makePage({ url: "http://ex.com/p", canonical: null }) });
    const report = await runAnalysis(dir, makeConfig());

    const fired = new Set(report.issues.map((i) => i.ruleId));
    for (const ruleId of report.rulesSkippedDataUnavailable) expect(fired.has(ruleId)).toBe(false);
    expect(report.rulesSkippedDataUnavailable).toContain("js-applied-noindex"); // renderDivergence is null
    expect(new Set(report.rulesSkippedDataUnavailable).size).toBe(report.rulesSkippedDataUnavailable.length);
  });

  it("tolerates a run directory missing failures/blocked/sitemaps/robots/report.json entirely", async () => {
    const dir = await makeRun({ p: makePage({ url: "http://ex.com/p" }) });
    await expect(runAnalysis(dir, makeConfig())).resolves.toBeDefined();
  });

  it("tolerates a run directory with no pages/ folder at all (zero pages analyzed)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "a3-engine-empty-"));
    dirs.push(dir);
    const report = await runAnalysis(dir, makeConfig());
    expect(report.pagesAnalyzed).toBe(0);
    expect(report.healthScore).toBe(100);
    expect(report.issues).toEqual([]);
  });
});

describe("runAnalysis — PageRank / graph wiring (priority wave)", () => {
  it("produces graph.json as part of normal analysis (previously only ~2 of ~102 real runs ever had one)", async () => {
    const dir = await makeRun({
      a: makePage({ url: "http://ex.com/a", finalUrl: "http://ex.com/a" }),
      b: makePage({ url: "http://ex.com/b", finalUrl: "http://ex.com/b" }),
    });
    const report = await runAnalysis(dir, makeConfig());
    expect(report.graphAvailable).toBe(true);
    const graph = JSON.parse(await readFile(path.join(dir, "graph.json"), "utf8"));
    expect(graph.pages).toHaveLength(2);
    expect(graph.runId).toBe(path.basename(dir));
  });

  it("a finding carries non-null importance/reach/confidence and a decomposable priorityFactors object", async () => {
    const dir = await makeRun({ p: makePage({ url: "http://ex.com/p", canonical: null }) }); // canonical-absent
    const report = await runAnalysis(dir, makeConfig());
    const f = report.findings.find((x) => x.ruleId === "canonical-absent")!;
    expect(f.status).toBe("failing");
    expect(f.importance).not.toBeNull();
    expect(f.reach).not.toBeNull();
    expect(f.confidence).toBe(1); // canonical-absent is tier "observed" in automation/classification.ts
    expect(f.priorityFactors).toEqual(
      expect.objectContaining({ severity: expect.any(Number), reach: expect.any(Number), importance: expect.any(Number), confidence: 1 }),
    );
    // automation/effort read from the automation registry, not re-derived
    expect(f.automation).toBe("auto-safe");
    expect(f.effort).toBe("low");
  });
});

describe("runAnalysis — worst-pages ranking (priority wave)", () => {
  it("ranks the page with more/worse findings above a clean page", async () => {
    const bad = makePage({
      url: "http://ex.com/bad",
      finalUrl: "http://ex.com/bad",
      title: null, // title-missing: error
      headings: { h1: [], h2: [], h3: [] }, // h1-missing: warning
      canonical: null, // canonical-absent: notice
    });
    const clean = makePage({
      url: "http://ex.com/clean",
      finalUrl: "http://ex.com/clean",
      title: "A perfectly fine title, well within the usual range",
    });
    const dir = await makeRun({ bad, clean });
    const report = await runAnalysis(dir, makeConfig());
    expect(report.worstPages.length).toBeGreaterThan(0);
    expect(report.worstPages[0]!.url).toBe("http://ex.com/bad");
    expect(report.worstPages[0]!.issueCount).toBeGreaterThan(1);
  });
});

describe("runAnalysis — mute / accepted risk, keyed per site (priority wave)", () => {
  it("muting a rule flips its finding to muted, recomputes the health score, and never deletes the finding", async () => {
    // The shared makePage() fixture already fails several unrelated rules (short title, thin
    // content, empty social tags, ...) — so "the score returns to 100" would be the wrong
    // assertion. Instead compare against a baseline run where canonical-absent never fires at
    // all: muting must land on EXACTLY that score, no more, no less — proving the recompute is
    // precise, not just "some improvement".
    const withCanonical = makePage({ url: "http://ex.com/p", finalUrl: "http://ex.com/p", canonical: "http://ex.com/p" });
    const withoutCanonical = { ...withCanonical, canonical: null };

    const baselineDir = await makeRun({ p: withCanonical });
    const baseline = await runAnalysis(baselineDir, makeConfig());
    expect(baseline.findings.find((f) => f.ruleId === "canonical-absent")!.status).toBe("passed");

    const { runDir, storageRoot } = await makeSiteRun("run-1", { p: withoutCanonical as CrawledPage }, "http://ex.com/p");

    const before = await runAnalysis(runDir, makeConfig());
    const beforeFinding = before.findings.find((f) => f.ruleId === "canonical-absent")!;
    expect(beforeFinding.status).toBe("failing");
    expect(before.mutedRuleIds).not.toContain("canonical-absent");
    expect(before.issues.some((i) => i.ruleId === "canonical-absent")).toBe(true);
    expect(before.healthScore).toBeLessThan(baseline.healthScore);

    await muteRule(storageRoot, "ex.com", "canonical-absent", { note: "known, accepted" });

    const after = await runAnalysis(runDir, makeConfig());
    const afterFinding = after.findings.find((f) => f.ruleId === "canonical-absent")!;

    expect(afterFinding.status).toBe("muted");
    expect(afterFinding.mutedNote).toBe("known, accepted");
    expect(afterFinding.priority).toBe(beforeFinding.priority); // still computed — never zeroed, never deleted
    expect(afterFinding.affectedPages).toBe(beforeFinding.affectedPages);
    expect(after.mutedRuleIds).toContain("canonical-absent");
    // the underlying issue is still present — muting never deletes a finding
    expect(after.issues.some((i) => i.ruleId === "canonical-absent")).toBe(true);
    // totals recompute, precisely: muted damage drops out and the score matches the baseline
    // where the rule never fired in the first place — not just "some improvement".
    expect(after.healthScore).toBeGreaterThan(before.healthScore);
    expect(after.healthScore).toBe(baseline.healthScore);
  });

  it("mutes are keyed per site, not per run — a second crawl of the same site inherits the mute", async () => {
    const page = makePage({ url: "http://ex.com/p", finalUrl: "http://ex.com/p", canonical: null });
    const { storageRoot } = await makeSiteRun("run-1", { p: page }, "http://ex.com/p");
    await muteRule(storageRoot, "ex.com", "canonical-absent");

    const run2 = path.join(storageRoot, "runs", "run-2");
    await mkdir(path.join(run2, "pages"), { recursive: true });
    await writeFile(path.join(run2, "pages", "p.json"), JSON.stringify(page));
    await writeFile(path.join(run2, "report.json"), JSON.stringify({ runId: "run-2", startUrl: "http://ex.com/p" }));

    const report2 = await runAnalysis(run2, makeConfig());
    expect(report2.findings.find((f) => f.ruleId === "canonical-absent")!.status).toBe("muted");
  });

  it("mutes on one site never apply to a different site (different start-URL host)", async () => {
    const page = makePage({ url: "http://ex.com/p", finalUrl: "http://ex.com/p", canonical: null });
    const { storageRoot } = await makeSiteRun("run-1", { p: page }, "http://ex.com/p");
    await muteRule(storageRoot, "another-site.com", "canonical-absent");

    const report = await runAnalysis(path.join(storageRoot, "runs", "run-1"), makeConfig());
    expect(report.findings.find((f) => f.ruleId === "canonical-absent")!.status).toBe("failing");
  });
});
