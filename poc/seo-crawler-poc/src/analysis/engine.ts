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

/** How much a failing check costs, relative to a check that passes clean. */
const SEVERITY_PENALTY: Record<IssueSeverity, number> = { error: 1, warning: 0.5, notice: 0.15 };

/**
 * Check-weighted health score, 0-100.
 *
 * The denominator is the number of checks that RAN, not the number of pages — so the score
 * answers "how much of the rulebook does this site pass", and a 10k-page site is not
 * automatically worse than a 10-page one. The previous model was
 * (pages - pagesWithAnyError) / pages, which pinned to 0 the moment one templated error hit
 * every page; our own acceptance run scored 0 that way and carried no information.
 *
 * Breadth enters through sqrt(coverage), which is deliberately concave: fully clearing one
 * check beats halving two, matching how Semrush documents its own model. A skipped check
 * (data unavailable) is excluded from both sides rather than counted as a pass.
 */
export function computeHealthScore(
  issues: Issue[],
  ranRuleIds: Set<string>,
  skipped: Set<string>,
  pagesAnalyzed: number,
  urlToPageId: Map<string, string>,
): number {
  const scored = [...ranRuleIds].filter((id) => !skipped.has(id));
  if (scored.length === 0 || pagesAnalyzed === 0) return 100;

  const affected = new Map<string, Set<string>>();
  const worst = new Map<string, IssueSeverity>();
  for (const issue of issues) {
    if (!scored.includes(issue.ruleId)) continue;
    const pageId = issue.pageId ?? (issue.url ? urlToPageId.get(issue.url) : undefined);
    // A finding that resolves to no page still counts as affecting one, so site-scope rules
    // are never silently free.
    const key = pageId ?? `__unanchored__:${issue.url ?? issue.ruleId}`;
    const set = affected.get(issue.ruleId) ?? new Set<string>();
    set.add(key);
    affected.set(issue.ruleId, set);
    const prev = worst.get(issue.ruleId);
    if (prev === undefined || SEVERITY_ORDER[issue.severity] < SEVERITY_ORDER[prev]) {
      worst.set(issue.ruleId, issue.severity);
    }
  }

  let penalty = 0;
  for (const ruleId of scored) {
    const hit = affected.get(ruleId);
    if (!hit || hit.size === 0) continue; // check passed clean
    const coverage = Math.min(1, hit.size / pagesAnalyzed);
    penalty += SEVERITY_PENALTY[worst.get(ruleId) ?? "notice"] * Math.sqrt(coverage);
  }

  const raw = 100 * (1 - penalty / scored.length);
  return Math.round(Math.max(0, Math.min(100, raw)) * 10) / 10;
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
  const ranRuleIds = new Set<string>();

  const rules = pageRules();
  for (const rule of rules) {
    if (!isRuleEnabled(rule.meta.id, config)) continue;
    rulesRun++;
    ranRuleIds.add(rule.meta.id);
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
      ranRuleIds.add(rule.meta.id);
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
  const healthScore = computeHealthScore(issues, ranRuleIds, skipped, pagesAnalyzed, urlToPageId);

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
