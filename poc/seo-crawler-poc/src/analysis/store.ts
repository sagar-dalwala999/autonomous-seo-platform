/** Slice A4 implements. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AnalysisReport, IssueSeverity } from "../models/types";

const SEVERITY_ORDER: Record<IssueSeverity, number> = { error: 0, warning: 1, notice: 2 };

/** severity -> ruleId -> url, so re-running the same analysis produces a byte-diffable file. */
function stableSort(report: AnalysisReport): AnalysisReport {
  const issues = [...report.issues].sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (bySeverity !== 0) return bySeverity;
    const byRule = a.ruleId.localeCompare(b.ruleId);
    if (byRule !== 0) return byRule;
    return (a.url ?? "").localeCompare(b.url ?? "");
  });
  return { ...report, issues };
}

/** Writes storage/runs/<runId>/issues.json (pretty, stable ordering: severity → ruleId → url). */
export async function writeIssues(runDir: string, report: AnalysisReport): Promise<void> {
  await mkdir(runDir, { recursive: true });
  const file = path.join(runDir, "issues.json");
  await writeFile(file, JSON.stringify(stableSort(report), null, 2), "utf8");
}

/** null when the run has never been analyzed. */
export async function readIssues(runDir: string): Promise<AnalysisReport | null> {
  try {
    const raw = await readFile(path.join(runDir, "issues.json"), "utf8");
    return JSON.parse(raw) as AnalysisReport;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}
