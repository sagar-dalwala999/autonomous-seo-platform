/** Slice A3 implements. */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type {
  AnalysisReport,
  CrawledPage,
  CrawlSummary,
  FailureRecord,
  Issue,
  IssueSeverity,
  RobotsEvidence,
  SitemapResult,
} from "../models/types";
import type { AnalysisConfig } from "./config";
import { pageRules } from "./rules/page/index";
import { siteRules } from "./rules/site/index";
import { writeIssues } from "./store";

async function readJsonSafe<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, "utf-8")) as T;
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") return fallback;
    throw err;
  }
}

interface PageEntry {
  page: CrawledPage;
  /** Derived from the pages/<pageId>.json filename — pageId is never stored on the record itself. */
  pageId: string;
}

async function readPages(runDir: string): Promise<PageEntry[]> {
  const pagesDir = path.join(runDir, "pages");
  let files: string[];
  try {
    files = await readdir(pagesDir);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") return [];
    throw err;
  }
  const entries: PageEntry[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const page = JSON.parse(await readFile(path.join(pagesDir, file), "utf-8")) as CrawledPage;
    entries.push({ page, pageId: file.slice(0, -".json".length) });
  }
  return entries;
}

function isRuleEnabled(ruleId: string, config: AnalysisConfig): boolean {
  return config.rules[ruleId]?.enabled !== false;
}

const SEVERITY_ORDER: Record<IssueSeverity, number> = { error: 0, warning: 1, notice: 2 };

/** Stable ordering: severity -> ruleId -> url, so the same run + config always produce byte-identical issues.json. */
function compareIssues(a: Issue, b: Issue): number {
  const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  if (bySeverity !== 0) return bySeverity;
  if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1;
  const au = a.url ?? "";
  const bu = b.url ?? "";
  if (au !== bu) return au < bu ? -1 : 1;
  return 0;
}

/**
 * Run the full rulebook (page rules + site passes) over a stored run directory and return the
 * assembled report (already persisted via store.writeIssues). Deterministic: same run + same
 * config → byte-identical issues (generatedAt aside).
 */
export async function runAnalysis(runDir: string, config: AnalysisConfig): Promise<AnalysisReport> {
  const pageEntries = await readPages(runDir);
  const failures = await readJsonSafe<FailureRecord[]>(path.join(runDir, "failures.json"), []);
  const blocked = await readJsonSafe<string[]>(path.join(runDir, "blocked.json"), []);
  const sitemap = await readJsonSafe<SitemapResult | null>(path.join(runDir, "sitemaps.json"), null);
  const robots = await readJsonSafe<RobotsEvidence | null>(path.join(runDir, "robots.json"), null);
  const summary = await readJsonSafe<CrawlSummary | null>(path.join(runDir, "report.json"), null);

  const urlToPageId = new Map<string, string>();
  for (const { page, pageId } of pageEntries) {
    urlToPageId.set(page.url, pageId);
    if (page.finalUrl) urlToPageId.set(page.finalUrl, pageId);
  }

  const issues: Issue[] = [];
  const skipped = new Set<string>();
  let rulesRun = 0;

  const rules = pageRules();
  for (const rule of rules) {
    if (!isRuleEnabled(rule.meta.id, config)) continue;
    rulesRun++;
    for (const { page, pageId } of pageEntries) {
      const result = rule.evaluate(page, config);
      if (result === null) {
        skipped.add(rule.meta.id);
        continue;
      }
      for (const issue of result) {
        issue.pageId = issue.pageId ?? pageId;
        issues.push(issue);
      }
    }
  }

  try {
    const siteRuleList = siteRules();
    const ctx = {
      pages: pageEntries.map((e) => e.page),
      failures,
      blocked,
      sitemap,
      robots,
      summary,
    };
    for (const rule of siteRuleList) {
      if (!isRuleEnabled(rule.meta.id, config)) continue;
      rulesRun++;
      const result = rule.evaluate(ctx, config);
      if (result === null) {
        skipped.add(rule.meta.id);
        continue;
      }
      // Loop, never spread: a site rule on a 1k+-page run can return enough issues that
      // spreading them as call arguments overflows the stack (hit live on books.toscrape).
      for (const issue of result) issues.push(issue);
    }
  } catch (err) {
    // A4's siteRules()/store.ts may still be a stub during A3's own dev/test cycle — proceed
    // page-only rather than block; integration wires the real implementation.
    if (err instanceof Error && err.message.startsWith("stub:")) {
      console.warn(`[analysis] site rules unavailable (${err.message}) — proceeding page-only`);
    } else {
      throw err;
    }
  }

  issues.sort(compareIssues);

  const counts: Record<IssueSeverity, number> = { error: 0, warning: 0, notice: 0 };
  for (const issue of issues) counts[issue.severity]++;

  const pagesAnalyzed = pageEntries.length;
  const errorPageIds = new Set(
    issues
      .filter((i) => i.severity === "error")
      .map((i) => i.pageId ?? (i.url ? urlToPageId.get(i.url) : undefined))
      .filter((id): id is string => id !== undefined && id !== null),
  );
  const healthScoreRaw = pagesAnalyzed === 0 ? 100 : ((pagesAnalyzed - errorPageIds.size) / pagesAnalyzed) * 100;
  const healthScore = Math.round(healthScoreRaw * 10) / 10;

  const report: AnalysisReport = {
    runId: path.basename(runDir),
    generatedAt: new Date().toISOString(),
    rulebookVersion: config.rulebookVersion,
    configSnapshot: config,
    healthScore,
    pagesAnalyzed,
    counts,
    rulesRun,
    rulesSkippedDataUnavailable: [...skipped].sort(),
    issues,
  };

  try {
    await writeIssues(runDir, report);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("stub:")) {
      console.warn(`[analysis] writeIssues unavailable (${err.message}) — report computed but not persisted`);
    } else {
      throw err;
    }
  }

  return report;
}
