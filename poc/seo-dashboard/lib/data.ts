/** Server-only (node:fs). Never import this from a "use client" file — no server-only pkg guard (not an allowed dep). */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type {
  BenchManifest,
  CrawledPageWithId,
  CrawlSummary,
  FailureRecord,
  RobotsEvidence,
  SitemapResult,
} from "./types";

// Turbopack warns this env-driven path defeats output-file tracing; harmless here — no standalone
// deploy/output tracing is used for this local POC (`next start`, not a traced bundle).
const STORAGE_ROOT = process.env.CRAWLER_STORAGE_DIR
  ? path.resolve(process.cwd(), process.env.CRAWLER_STORAGE_DIR)
  : path.resolve(process.cwd(), "..", "seo-crawler-poc", "storage");

const RUNS_DIR = path.join(STORAGE_ROOT, "runs");
const BENCH_DIR = path.join(STORAGE_ROOT, "bench");

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") console.warn(`[lib/data] malformed JSON skipped: ${filePath}`);
    return null;
  }
}

async function listDirs(dirPath: string): Promise<string[]> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

export interface RunListItem {
  runId: string;
  startUrl: string;
  startedAt: string;
  finishedAt: string;
  attempted: number;
  successful: number;
  failed: number;
  blockedByRobots: number;
  coveragePercent: number;
}

export async function listRuns(): Promise<RunListItem[]> {
  const runIds = await listDirs(RUNS_DIR);
  const items: RunListItem[] = [];
  let skipped = 0;
  for (const runId of runIds) {
    const report = await readJson<CrawlSummary>(path.join(RUNS_DIR, runId, "report.json"));
    if (!report) {
      skipped++;
      continue;
    }
    items.push({
      runId: report.runId ?? runId,
      startUrl: report.startUrl,
      startedAt: report.startedAt,
      finishedAt: report.finishedAt,
      attempted: report.attempted,
      successful: report.successful,
      failed: report.failed,
      blockedByRobots: report.blockedByRobots,
      coveragePercent: report.coveragePercent,
    });
  }
  if (skipped > 0) console.warn(`[lib/data] listRuns: skipped ${skipped} run(s) with missing/malformed report.json`);
  return items.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

/** Pages own no run-selector yet (S9 scope) — default to the latest run, honor ?run= when valid. */
export async function resolveRunId(requested?: string): Promise<string | null> {
  const runs = await listRuns();
  if (requested && runs.some((r) => r.runId === requested)) return requested;
  return runs[0]?.runId ?? null;
}

export interface RunDetail {
  report: CrawlSummary | null;
  robots: RobotsEvidence | null;
  sitemaps: SitemapResult | null;
  blocked: string[];
  failures: FailureRecord[];
}

export async function getRun(runId: string): Promise<RunDetail> {
  const dir = path.join(RUNS_DIR, runId);
  const [report, robots, sitemaps, blocked, failures] = await Promise.all([
    readJson<CrawlSummary>(path.join(dir, "report.json")),
    readJson<RobotsEvidence>(path.join(dir, "robots.json")),
    readJson<SitemapResult>(path.join(dir, "sitemaps.json")),
    readJson<string[]>(path.join(dir, "blocked.json")),
    readJson<FailureRecord[]>(path.join(dir, "failures.json")),
  ]);
  return { report, robots, sitemaps, blocked: blocked ?? [], failures: failures ?? [] };
}

/** runId -> parsed pages, loaded once and reused (POC scale: hundreds of pages, fine in memory). */
const pagesCache = new Map<string, Promise<CrawledPageWithId[]>>();

async function loadPages(runId: string): Promise<CrawledPageWithId[]> {
  let cached = pagesCache.get(runId);
  if (cached) return cached;
  cached = (async () => {
    const dir = path.join(RUNS_DIR, runId, "pages");
    let files: string[];
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
    } catch {
      return [];
    }
    const results: CrawledPageWithId[] = [];
    let skipped = 0;
    for (const file of files) {
      const page = await readJson<CrawledPageWithId>(path.join(dir, file));
      if (!page) {
        skipped++;
        continue;
      }
      results.push({ ...page, pageId: file.replace(/\.json$/, "") });
    }
    if (skipped > 0) console.warn(`[lib/data] loadPages(${runId}): skipped ${skipped} malformed page file(s)`);
    return results;
  })();
  pagesCache.set(runId, cached);
  return cached;
}

export interface GetPagesOptions {
  status?: "2xx" | "3xx" | "4xx" | "5xx";
  rendered?: "http" | "playwright";
  q?: string;
  sort?: "url" | "statusCode" | "responseTimeMs" | "depth" | "fetchedAt";
  dir?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export interface GetPagesResult {
  items: CrawledPageWithId[];
  total: number;
}

function sortValue(p: CrawledPageWithId, key: NonNullable<GetPagesOptions["sort"]>): string | number | null {
  switch (key) {
    case "url":
      return p.url;
    case "statusCode":
      return p.statusCode;
    case "responseTimeMs":
      return p.performance.responseTimeMs;
    case "depth":
      return p.crawl.depth;
    case "fetchedAt":
      return p.fetchedAt;
  }
}

export async function getPages(runId: string, opts: GetPagesOptions = {}): Promise<GetPagesResult> {
  let items = await loadPages(runId);

  if (opts.status) {
    const bucket = Number(opts.status[0]);
    items = items.filter((p) => p.statusCode !== null && Math.floor(p.statusCode / 100) === bucket);
  }
  if (opts.rendered) {
    items = items.filter((p) => p.renderedWith === opts.rendered);
  }
  if (opts.q) {
    const needle = opts.q.toLowerCase();
    items = items.filter(
      (p) => p.url.toLowerCase().includes(needle) || p.normalizedUrl.toLowerCase().includes(needle),
    );
  }

  const total = items.length;

  if (opts.sort) {
    const sortKey = opts.sort;
    const dirMul = opts.dir === "desc" ? -1 : 1;
    items = [...items].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (av === null) return 1;
      if (bv === null) return -1;
      if (av < bv) return -1 * dirMul;
      if (av > bv) return 1 * dirMul;
      return 0;
    });
  }

  if (opts.offset || opts.limit) {
    const start = opts.offset ?? 0;
    const end = opts.limit ? start + opts.limit : undefined;
    items = items.slice(start, end);
  }

  return { items, total };
}

export async function getPage(runId: string, pageId: string): Promise<CrawledPageWithId | null> {
  const cached = pagesCache.get(runId);
  if (cached) {
    const found = (await cached).find((p) => p.pageId === pageId);
    if (found) return found;
  }
  const page = await readJson<CrawledPageWithId>(path.join(RUNS_DIR, runId, "pages", `${pageId}.json`));
  return page ? { ...page, pageId } : null;
}

/** Pure path resolver — no I/O. Caller stats/serves the file (S10 scope). */
export function rawHtmlPath(runId: string, pageId: string): string {
  return path.join(RUNS_DIR, runId, "raw", `${pageId}.html`);
}

/** Trust boundary for callers serving files by id — see app/api/raw's containment check. */
export function runsDir(): string {
  return RUNS_DIR;
}

export async function getBench(): Promise<BenchManifest[]> {
  const stamps = (await listDirs(BENCH_DIR)).filter((d) => d !== "server-logs");
  const manifests: BenchManifest[] = [];
  let skipped = 0;
  for (const stamp of stamps) {
    const manifest = await readJson<BenchManifest>(path.join(BENCH_DIR, stamp, "manifest.json"));
    if (!manifest) {
      skipped++;
      continue;
    }
    manifests.push(manifest);
  }
  if (skipped > 0) console.warn(`[lib/data] getBench: skipped ${skipped} entr(y/ies) with missing/malformed manifest.json`);
  return manifests.sort((a, b) => (a.stamp < b.stamp ? 1 : -1));
}

/** Informational path shown in the sidebar's Help & support item — not guaranteed to exist yet. */
export function getReportPath(): string {
  return path.resolve(STORAGE_ROOT, "..", "POC-1-REPORT.md");
}
