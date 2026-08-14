/**
 * Server-only. New lib file. Persisted comparisons for POST/GET /comparisons (spec §7, §9).
 * PLAN-03 §9.5 wants "computed asynchronously by a worker... cached as a row keyed
 * (runA, runB, algoVersion)". This POC has no worker/DB, so a comparison is computed
 * synchronously (page counts here are POC-scale — see data-compare.ts's own note on this) and
 * persisted as a JSON file under storage/comparisons/, which is the closest honest equivalent of
 * "a cached row" available without a database. The 202-style async shape is preserved in the API
 * contract (status is 'completed' immediately, never faked as still-running).
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { computeDiff, type CrawlDiff } from "./data-compare";
import { getRun, listRuns } from "./data";
import { readAnalysisReport } from "./data-issues";

const STORAGE_ROOT = process.env.CRAWLER_STORAGE_DIR
  ? path.resolve(process.cwd(), process.env.CRAWLER_STORAGE_DIR)
  : path.resolve(process.cwd(), "..", "seo-crawler-poc", "storage");
const COMPARISONS_DIR = path.join(STORAGE_ROOT, "comparisons");

export type ComparisonMode = "run-over-run" | "competitor";

export interface ComparisonSummary {
  id: string;
  baseCrawlId: string;
  againstCrawlId: string;
  mode: ComparisonMode;
  createdAt: string;
  status: "completed" | "failed";
}

export interface CompetitorAggregate {
  base: { runId: string; healthScore: number | null; pagesAnalyzed: number | null; coveragePercent: number };
  against: { runId: string; healthScore: number | null; pagesAnalyzed: number | null; coveragePercent: number };
}

export interface ComparisonResult extends ComparisonSummary {
  runOverRun: CrawlDiff | null;
  competitor: CompetitorAggregate | null;
}

export class ComparisonError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function ensureDir(): Promise<void> {
  await mkdir(COMPARISONS_DIR, { recursive: true });
}

function filePath(id: string): string {
  return path.join(COMPARISONS_DIR, `${id}.json`);
}

export async function createComparison(baseCrawlId: string, againstCrawlId: string, mode: ComparisonMode): Promise<ComparisonResult> {
  const runs = await listRuns();
  if (!runs.some((r) => r.runId === baseCrawlId)) throw new ComparisonError(`Base run "${baseCrawlId}" not found.`, 404);
  if (!runs.some((r) => r.runId === againstCrawlId)) throw new ComparisonError(`Comparison run "${againstCrawlId}" not found.`, 404);

  const id = randomUUID();
  const base: ComparisonSummary = { id, baseCrawlId, againstCrawlId, mode, createdAt: new Date().toISOString(), status: "completed" };

  let runOverRun: CrawlDiff | null = null;
  let competitor: CompetitorAggregate | null = null;

  if (mode === "run-over-run") {
    runOverRun = await computeDiff(baseCrawlId, againstCrawlId);
  } else {
    const [baseRun, againstRun, baseReport, againstReport] = await Promise.all([
      getRun(baseCrawlId),
      getRun(againstCrawlId),
      readAnalysisReport(baseCrawlId),
      readAnalysisReport(againstCrawlId),
    ]);
    competitor = {
      base: { runId: baseCrawlId, healthScore: baseReport?.healthScore ?? null, pagesAnalyzed: baseReport?.pagesAnalyzed ?? null, coveragePercent: baseRun.report?.coveragePercent ?? 0 },
      against: { runId: againstCrawlId, healthScore: againstReport?.healthScore ?? null, pagesAnalyzed: againstReport?.pagesAnalyzed ?? null, coveragePercent: againstRun.report?.coveragePercent ?? 0 },
    };
  }

  const result: ComparisonResult = { ...base, runOverRun, competitor };
  await ensureDir();
  await writeFile(filePath(id), JSON.stringify(result, null, 2), "utf8");
  return result;
}

export async function getComparison(id: string): Promise<ComparisonResult | null> {
  try {
    return JSON.parse(await readFile(filePath(id), "utf8")) as ComparisonResult;
  } catch {
    return null;
  }
}

export async function listComparisons(siteFilterRunId?: string | null): Promise<ComparisonSummary[]> {
  await ensureDir();
  let ids: string[];
  try {
    ids = (await readdir(COMPARISONS_DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const all = await Promise.all(
    ids.map(async (f) => {
      try {
        const r = JSON.parse(await readFile(path.join(COMPARISONS_DIR, f), "utf8")) as ComparisonResult;
        const { runOverRun, competitor, ...summary } = r;
        void runOverRun;
        void competitor;
        return summary;
      } catch {
        return null;
      }
    }),
  );
  let rows = all.filter((r): r is ComparisonSummary => r !== null);
  if (siteFilterRunId) rows = rows.filter((r) => r.baseCrawlId === siteFilterRunId || r.againstCrawlId === siteFilterRunId);
  return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
