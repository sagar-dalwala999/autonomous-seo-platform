/**
 * Server-only (node:fs). Additive reads of the sibling analysis outputs that live next to
 * issues.json (automation-report.json, fix-plan.json) — optional-safe, same pattern as
 * data-issues.ts. These files are written by separate CLI commands (npm run analyze:automation /
 * npm run fixplan), so most runs will NOT have them yet: every reader here returns null rather
 * than guessing, and callers must degrade visibly (never fabricate automation/effort/confidence).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { listRuns } from "./data";
import { readAnalysisReport } from "./data-issues";
import type { IssueSeverity } from "./types";

const STORAGE_ROOT = process.env.CRAWLER_STORAGE_DIR
  ? path.resolve(process.cwd(), process.env.CRAWLER_STORAGE_DIR)
  : path.resolve(process.cwd(), "..", "seo-crawler-poc", "storage");

const RUNS_DIR = path.join(STORAGE_ROOT, "runs");

export type AutomationLevel = "auto-safe" | "auto-with-review" | "human-only";

export interface RuleAutomationSummary {
  ruleId: string;
  category: string;
  scope: "page" | "site";
  automation: AutomationLevel;
  confidence: number;
  reviewed: boolean;
  rationale: string;
  affectedPages: number;
  instances: number;
  effort: { level: "low" | "medium" | "high"; why: string };
}

export interface AutomationReport {
  runId: string;
  generatedAt: string;
  pagesAnalyzed: number;
  counts: Record<AutomationLevel, number>;
  rules: RuleAutomationSummary[];
  unreviewedRuleIds: string[];
}

/** null = automation-report.json hasn't been generated for this run yet (npm run analyze:automation
 *  wasn't run) — callers must show "not classified" rather than assume a level. */
export async function readAutomationReport(runId: string): Promise<AutomationReport | null> {
  try {
    const text = await readFile(path.join(RUNS_DIR, runId, "automation-report.json"), "utf8");
    return JSON.parse(text) as AutomationReport;
  } catch {
    return null;
  }
}

export function automationByRuleId(report: AutomationReport | null): Map<string, RuleAutomationSummary> {
  const map = new Map<string, RuleAutomationSummary>();
  if (!report) return map;
  for (const r of report.rules) map.set(r.ruleId, r);
  return map;
}

export interface FixPlanItem {
  rule: string;
  issue: string;
  url: string | null;
  pageId: string | null;
  action: string;
  where: string;
  change: string | string[];
  note: string;
}

export interface FixPlanSkip {
  rule: string;
  url: string | null;
  reason: string;
}

export interface FixPlan {
  runId: string;
  generatedAt: string;
  applied: false;
  note: string;
  rules: { id: string; findings: number }[];
  totalChanges: number;
  items: FixPlanItem[];
  skipped: FixPlanSkip[];
}

/** null = fix-plan.json hasn't been generated for this run yet (npm run fixplan wasn't run). */
export async function readFixPlan(runId: string): Promise<FixPlan | null> {
  try {
    const text = await readFile(path.join(RUNS_DIR, runId, "fix-plan.json"), "utf8");
    return JSON.parse(text) as FixPlan;
  } catch {
    return null;
  }
}

export interface HealthHistoryPoint {
  runId: string;
  startedAt: string;
  healthScore: number | null;
  counts: Record<IssueSeverity, number> | null;
  /** ruleId -> issue count in that run — lets the UI diff rule-by-rule against the previous crawl
   *  without a second read. null when the run has no issues.json at all. */
  ruleCounts: Record<string, number> | null;
}

const MAX_HISTORY_RUNS = 20;

/** Every earlier judged crawl of the same site (by exact startUrl match), oldest first, capped to
 *  the most recent MAX_HISTORY_RUNS so a site with a long run history doesn't fan out into dozens
 *  of file reads on every page load. Health score is read straight off each run's own issues.json
 *  — never re-derived here. */
export async function readHealthHistory(startUrl: string): Promise<HealthHistoryPoint[]> {
  const runs = await listRuns();
  const sameSite = runs
    .filter((r) => r.startUrl === startUrl)
    .sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1))
    .slice(-MAX_HISTORY_RUNS);

  const points: HealthHistoryPoint[] = [];
  for (const r of sameSite) {
    const report = await readAnalysisReport(r.runId);
    let ruleCounts: Record<string, number> | null = null;
    if (report) {
      ruleCounts = {};
      for (const issue of report.issues) ruleCounts[issue.ruleId] = (ruleCounts[issue.ruleId] ?? 0) + 1;
    }
    points.push({
      runId: r.runId,
      startedAt: r.startedAt,
      healthScore: report?.healthScore ?? null,
      counts: report?.counts ?? null,
      ruleCounts,
    });
  }
  return points;
}
