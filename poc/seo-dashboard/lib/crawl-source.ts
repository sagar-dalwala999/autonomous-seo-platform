/**
 * Crawl-data Postgres adapter for the dashboard's read layer.
 *
 * The crawler writes flat JSON to this machine's disk (the source of truth for this POC) AND,
 * when it can reach Postgres, a faithful projection of the same run into `packages/db` via
 * syncRunToPostgres. That DB copy is what lets a dashboard on ANOTHER machine — with no local
 * run files — show the same runs, pages, issues and overview data.
 *
 * Policy: JSON-first, DB-fallback, per run. A run that exists on this disk is read from JSON
 * (full fidelity, including deep detail the DB doesn't persist); a run that only exists in
 * Postgres is reconstructed from the DB (lib/data.ts + lib/data-issues.ts decide which). This
 * means a machine that crawled a site locally behaves exactly as before, while a machine with
 * only the DB still sees everything.
 *
 * Loading mirrors lib/gsc/storage.ts: the same runtime-computed dynamic import of
 * packages/db/dist/index.js (zero build-time coupling, no npm dependency). Backend resolved once:
 * DB if it connects, else JSON with a single logged warning. CRAWL_DB_ENABLED=false forces JSON.
 *
 * Side effect: when Postgres is reachable, POSTGRES_SYNC_ENABLED defaults to "true" in this
 * server's process env, so crawls this dashboard spawns (which inherit env: process.env) sync to
 * the DB automatically — the Option-A "enable the sync" half. An explicit "false" is respected.
 *
 * Server-only. Never import from a "use client" file.
 */
import { stat } from "node:fs/promises";
import path from "node:path";
import type { AnalysisReport, CrawlSummary, CrawledPageWithId, FailureRecord, RobotsEvidence, SitemapResult, SkippedUrlRecord } from "./types";

/** Structural twin of lib/data.ts's RunListItem — defined here to avoid a type-only import cycle. */
export interface CrawlRunListItem {
  runId: string;
  startUrl: string;
  startedAt: string;
  finishedAt: string;
  attempted: number;
  successful: number;
  failed: number;
  blockedByRobots: number;
  coveragePercent: number;
  maxDepthSeen: number | null;
  state?: "completed" | "cancelled";
  analyzed?: boolean;
  healthScore?: number | null;
}

const STORAGE_ROOT = process.env.CRAWLER_STORAGE_DIR
  ? path.resolve(process.cwd(), process.env.CRAWLER_STORAGE_DIR)
  : path.resolve(process.cwd(), "..", "seo-crawler-poc", "storage");

export const RUNS_DIR = path.join(STORAGE_ROOT, "runs");

export interface RunDetailFromDb {
  report: CrawlSummary | null;
  robots: RobotsEvidence | null;
  sitemaps: SitemapResult | null;
  blocked: string[];
  failures: FailureRecord[];
}

type PrismaLike = { $queryRaw: (q: unknown) => Promise<unknown> };

type DbModule = {
  loadEnv: () => void;
  createPrismaClient: (profile: string) => PrismaLike;
  dbListCrawlRuns: (p: PrismaLike) => Promise<CrawlRunListItem[]>;
  dbGetCrawlRun: (p: PrismaLike, runId: string) => Promise<RunDetailFromDb | null>;
  dbReadCrawlSkipped: (p: PrismaLike, runId: string) => Promise<SkippedUrlRecord[]>;
  dbGetCrawlPages: (p: PrismaLike, runId: string) => Promise<CrawledPageWithId[]>;
  dbGetCrawlPage: (p: PrismaLike, runId: string, pageKey: string) => Promise<CrawledPageWithId | null>;
  dbReadCrawlAnalysis: (p: PrismaLike, runId: string) => Promise<AnalysisReport | null>;
  dbCrawlExists: (p: PrismaLike, runId: string) => Promise<boolean>;
  importIssuesToPostgres: (
    p: PrismaLike,
    runDir: string,
    runId: string,
  ) => Promise<{ findingsInserted: number; issuesInserted: number; skippedReason: string | null }>;
};

let dbModule: DbModule | null = null;
let prisma: PrismaLike | null = null;
let backend: "db" | "json" | null = null;
let warned = false;

function dbDistPath(): string {
  return path.resolve(process.cwd(), "..", "..", "packages", "db", "dist", "index.js");
}

async function ensureDb(): Promise<boolean> {
  if (backend) return backend === "db";
  if (process.env.CRAWL_DB_ENABLED === "false") {
    backend = "json";
    return false;
  }
  try {
    const distPath = dbDistPath();
    const url = new URL(`file:///${distPath.replace(/\\/g, "/")}`).href;
    const mod = (await import(url)) as DbModule;
    mod.loadEnv();
    const client = mod.createPrismaClient("rollup");
    await client.$queryRaw`SELECT 1`;
    dbModule = mod;
    prisma = client;
    backend = "db";
    // Option A: make every crawl this dashboard spawns sync to Postgres. Only set the default —
    // an explicit POSTGRES_SYNC_ENABLED=false in the environment is respected.
    if (process.env.POSTGRES_SYNC_ENABLED !== "false") {
      process.env.POSTGRES_SYNC_ENABLED = "true";
    }
    return true;
  } catch (err) {
    if (!warned) {
      console.warn(
        "[crawl-source] Postgres unavailable — crawl reads fall back to local JSON only. " +
          "Runs synced from another machine won't appear until packages/db can connect. " +
          `(${err instanceof Error ? err.message : String(err)})`,
      );
      warned = true;
    }
    backend = "json";
    return false;
  }
}

async function db(): Promise<PrismaLike | null> {
  return (await ensureDb()) ? prisma : null;
}

/** True when the run's report.json exists on THIS machine's disk — the JSON path wins then. */
export async function hasRunOnDisk(runId: string): Promise<boolean> {
  try {
    await stat(path.join(RUNS_DIR, runId, "report.json"));
    return true;
  } catch {
    return false;
  }
}

export async function dbListCrawlRuns(): Promise<CrawlRunListItem[] | null> {
  const client = await db();
  if (!client) return null;
  return dbModule!.dbListCrawlRuns(client);
}

export async function dbGetCrawlRun(runId: string): Promise<RunDetailFromDb | null> {
  const client = await db();
  if (!client) return null;
  return dbModule!.dbGetCrawlRun(client, runId);
}

export async function dbReadCrawlSkipped(runId: string): Promise<SkippedUrlRecord[] | null> {
  const client = await db();
  if (!client) return null;
  return dbModule!.dbReadCrawlSkipped(client, runId);
}

export async function dbGetCrawlPages(runId: string): Promise<CrawledPageWithId[] | null> {
  const client = await db();
  if (!client) return null;
  return dbModule!.dbGetCrawlPages(client, runId);
}

export async function dbGetCrawlPage(runId: string, pageKey: string): Promise<CrawledPageWithId | null> {
  const client = await db();
  if (!client) return null;
  return dbModule!.dbGetCrawlPage(client, runId, pageKey);
}

export async function dbReadCrawlAnalysis(runId: string): Promise<AnalysisReport | null> {
  const client = await db();
  if (!client) return null;
  return dbModule!.dbReadCrawlAnalysis(client, runId);
}

/** Post-analyze findings sync — best-effort, never throws (the caller's crawl must not fail). */
export async function syncRunFindingsToDb(runId: string): Promise<void> {
  try {
    const client = await db();
    if (!client) return;
    await dbModule!.importIssuesToPostgres(client, path.join(RUNS_DIR, runId), runId);
  } catch (err) {
    console.warn(`[crawl-source] findings sync failed for ${runId} — local JSON unaffected: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Called before spawning a crawl so the sync env default is set even on a fresh server boot. */
export async function ensureCrawlSyncEnabled(): Promise<void> {
  await ensureDb();
}
