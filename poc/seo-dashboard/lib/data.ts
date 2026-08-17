/** Server-only (node:fs). Never import this from a "use client" file — no server-only pkg guard (not an allowed dep). */
import { readFile, readdir, stat, open } from "node:fs/promises";
import path from "node:path";
import { pickDefaultRun } from "./run-selection";
import { getCrawlStatus } from "./crawl-runner";
import { hasRunOnDisk, dbListCrawlRuns, dbGetCrawlRun, dbGetCrawlPages, dbGetCrawlPage, dbReadCrawlSkipped } from "./crawl-source";
import type {
  CrawledPageWithId,
  CrawlSummary,
  FailureRecord,
  RobotsEvidence,
  SitemapResult,
  SkippedUrlRecord,
} from "./types";

// Turbopack warns this env-driven path defeats output-file tracing; harmless here — no standalone
// deploy/output tracing is used for this local POC (`next start`, not a traced bundle).
const STORAGE_ROOT = process.env.CRAWLER_STORAGE_DIR
  ? path.resolve(process.cwd(), process.env.CRAWLER_STORAGE_DIR)
  : path.resolve(process.cwd(), "..", "seo-crawler-poc", "storage");

const RUNS_DIR = path.join(STORAGE_ROOT, "runs");

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

/** Filename count only, no parsing — a cancelled run still writes each page as it's crawled
 *  (report.json is the only thing the kill pre-empts), so this is real, not a placeholder zero. */
async function countPageFiles(runId: string): Promise<number> {
  try {
    return (await readdir(path.join(RUNS_DIR, runId, "pages"))).filter((f) => f.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

/** Presence check only, no parsing — the run selector's "Analyze" affordance needs to know which
 *  runs have an issues.json (analyzed) and which don't (offer Analyze). Deliberately a stat, not a
 *  readAnalysisReport: listRuns runs on every layout render and shouldn't pay parse cost per run. */
async function hasIssues(runId: string): Promise<boolean> {
  try {
    await stat(path.join(RUNS_DIR, runId, "issues.json"));
    return true;
  } catch {
    return false;
  }
}

/** Health score read as a PREFIX scan, not a full parse — issues.json for a big run is megabyte-
 *  sized and listRuns runs on every layout render, so the selector's health dot reads only the
 *  first chunk (healthScore is a top-level field near the top of the file) and regexes it out.
 *  null when the run has no issues.json or the field is absent (predates the health score). */
async function readHealthScore(runId: string): Promise<number | null> {
  try {
    const fh = await open(path.join(RUNS_DIR, runId, "issues.json"), "r");
    try {
      const buf = Buffer.alloc(4096);
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      const head = buf.toString("utf8", 0, bytesRead);
      const m = head.match(/"healthScore"\s*:\s*([0-9.]+)/);
      return m ? Number(m[1]) : null;
    } finally {
      await fh.close();
    }
  } catch {
    return null;
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
  /** null on runs written before the crawler recorded it — the /runs table shows "—". */
  maxDepthSeen: number | null;
  /** "completed" (has a report.json) or "cancelled" (stopped by the user before one could be
   *  written — see lib/crawl-control.ts's cancelCrawl). Undefined on any RunListItem built from
   *  raw report data elsewhere (e.g. the running-crawl synthetic row in app/api/crawls/route.ts) —
   *  callers that care check for "cancelled" specifically, so a missing field just means "not that". */
  state?: "completed" | "cancelled";
  /** True when this run has an issues.json — the run selector offers an "Analyze" action for
   *  unanalyzed runs (false/absent), and a fresh analyze writes issues.json + automation-report.json
   *  + fix-plan.json. Not read from report.json (the crawler never records it there), so it is
   *  computed here by checking the run dir. */
  analyzed?: boolean;
  /** Health score from the run's issues.json when analyzed (prefix scan, see readHealthScore);
   *  null on unanalyzed runs or runs that predate the score. Drives the selector's health dot. */
  healthScore?: number | null;
}

/** Pure merge used by listRuns: JSON runs win (full fidelity), DB-only runs fill the gaps. */
export function mergeRunLists(jsonRuns: RunListItem[], dbRuns: RunListItem[]): RunListItem[] {
  const seen = new Set(jsonRuns.map((r) => r.runId));
  const merged = [...jsonRuns];
  for (const dbRun of dbRuns) {
    if (!seen.has(dbRun.runId)) merged.push(dbRun);
  }
  return merged.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

async function listRunsFromDisk(): Promise<RunListItem[]> {
  const runIds = await listDirs(RUNS_DIR);
  const items: RunListItem[] = [];
  let skipped = 0;
  for (const runId of runIds) {
    const report = await readJson<CrawlSummary>(path.join(RUNS_DIR, runId, "report.json"));
    if (report) {
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
        maxDepthSeen: typeof report.maxDepthSeen === "number" ? report.maxDepthSeen : null,
        state: "completed",
        analyzed: await hasIssues(runId),
        healthScore: await readHealthScore(runId),
      });
      continue;
    }
    // No report.json — a cancelled run never gets one (the process is killed before it can write
    // it), so without this branch it would vanish from history entirely (still fetchable by exact
    // ID, but absent from every list). Surface it from the dashboard's own status sidecar instead.
    // Still-running / genuinely-crashed reportless runs fall through to skipped, unchanged from
    // before — this endpoint's own live-crawl merge (app/api/crawls/route.ts) already covers running.
    const status = await getCrawlStatus(runId);
    if (status?.state === "cancelled") {
      const pagesCrawled = await countPageFiles(runId);
      items.push({
        runId: status.runId,
        startUrl: status.startUrl,
        startedAt: status.startedAt,
        finishedAt: status.endedAt ?? status.startedAt,
        attempted: pagesCrawled,
        successful: pagesCrawled,
        failed: 0,
        blockedByRobots: 0,
        coveragePercent: 0,
        maxDepthSeen: null,
        state: "cancelled",
        analyzed: await hasIssues(runId),
        healthScore: null,
      });
      continue;
    }
    skipped++;
  }
  if (skipped > 0) console.warn(`[lib/data] listRuns: skipped ${skipped} run(s) with missing/malformed report.json`);
  return items.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

/** Runs on this disk (JSON, full fidelity) merged with runs that only exist in Postgres (e.g.
 *  crawled on another machine) — same runId is never duplicated, the local copy wins. */
export async function listRuns(): Promise<RunListItem[]> {
  const jsonRuns = await listRunsFromDisk();
  const dbRuns = await dbListCrawlRuns();
  return dbRuns ? mergeRunLists(jsonRuns, dbRuns) : jsonRuns;
}

/** A valid ?run= always wins; otherwise pickDefaultRun's rule decides (see lib/run-selection.ts). */
export async function resolveRunId(requested?: string): Promise<string | null> {
  const runs = await listRuns();
  if (requested && runs.some((r) => r.runId === requested)) return requested;
  return pickDefaultRun(runs)?.runId ?? null;
}

export interface RunDetail {
  report: CrawlSummary | null;
  robots: RobotsEvidence | null;
  sitemaps: SitemapResult | null;
  blocked: string[];
  failures: FailureRecord[];
}

async function getRunFromDisk(runId: string): Promise<RunDetail> {
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

/** JSON when this machine has the run's files, otherwise reconstruct from Postgres. */
export async function getRun(runId: string): Promise<RunDetail> {
  if (await hasRunOnDisk(runId)) return getRunFromDisk(runId);
  const dbDetail = await dbGetCrawlRun(runId);
  if (dbDetail) return dbDetail;
  return { report: null, robots: null, sitemaps: null, blocked: [], failures: [] };
}

/** Additive (B3). skipped.json is absent on runs from before the safety guard rails shipped
 *  (or on runs with no auth) — optional-safe, [] means "nothing skipped", never an error. */
export async function readSkipped(runId: string): Promise<SkippedUrlRecord[]> {
  if (await hasRunOnDisk(runId)) {
    const skipped = await readJson<SkippedUrlRecord[]>(path.join(RUNS_DIR, runId, "skipped.json"));
    return skipped ?? [];
  }
  const dbSkipped = await dbReadCrawlSkipped(runId);
  return dbSkipped ?? [];
}

/** runId -> parsed pages. Map iteration order is insertion order, so the first key is the
 *  least-recently-used once every hit re-inserts — that's the eviction victim. */
const pagesCache = new Map<string, { stamp: number; pages: Promise<CrawledPageWithId[]> }>();
const PAGES_CACHE_MAX_RUNS = 8;

/** report.json is rewritten at the end of every run, so its mtime changes even when a re-crawl
 *  reuses a runId and overwrites page files in place (which leaves the pages dir mtime alone).
 *  0 = no report yet (crawl still running) — a later real mtime then invalidates. */
async function runStamp(runId: string): Promise<number> {
  try {
    return (await stat(path.join(RUNS_DIR, runId, "report.json"))).mtimeMs;
  } catch {
    return 0;
  }
}

// Sequential await-in-a-loop over 1000+ page files was the 30s+ cold-read defect (same class as
// the /runs screen parsing 7,473 JSONs per request). Bounded worker pool keeps the file-handle
// count sane on very large runs while still reading pages in parallel instead of one at a time.
const READ_DIR_CONCURRENCY = 64;

async function readPagesDir(runId: string): Promise<CrawledPageWithId[]> {
  const dir = path.join(RUNS_DIR, runId, "pages");
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }

  const slots: (CrawledPageWithId | null)[] = new Array(files.length).fill(null);
  let skipped = 0;
  let next = 0;

  async function worker(): Promise<void> {
    for (let i = next++; i < files.length; i = next++) {
      const file = files[i];
      const page = await readJson<CrawledPageWithId>(path.join(dir, file));
      if (!page) {
        skipped++;
        continue;
      }
      slots[i] = { ...page, pageId: file.replace(/\.json$/, "") };
    }
  }

  const workerCount = Math.min(READ_DIR_CONCURRENCY, files.length);
  await Promise.all(Array.from({ length: workerCount }, worker));

  if (skipped > 0) console.warn(`[lib/data] getPages(${runId}): skipped ${skipped} malformed page file(s)`);
  return slots.filter((p): p is CrawledPageWithId => p !== null);
}

/** Cursor read: yields pages as they're read off disk in bounded batches, never holding more
 *  than READ_DIR_CONCURRENCY (64) parsed CrawledPageWithId objects at once. getPages() below
 *  materializes the whole run into one array (plus an 8-run LRU cache on top) — at the ~130KB/page
 *  retained-heap rate that exhausts a 4GB heap around 32k pages, well under the 100k-page target.
 *  Built for the pages-table read (lib/data-pages.ts's buildPageRows), which only needs to keep a
 *  small PageRow projection per matching page, not the full record. getPages() stays exactly as-is
 *  for callers that already need the complete in-memory set for a genuine whole-corpus operation
 *  (graph, export, compare, dedup) — those still hold O(pages), inherently, to do their job.
 *  Deliberately uncached: caching every streamed page would just re-create the problem this exists
 *  to avoid. */
async function* streamPagesFromDisk(runId: string): AsyncGenerator<CrawledPageWithId> {
  const dir = path.join(RUNS_DIR, runId, "pages");
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    return;
  }

  let skipped = 0;
  for (let i = 0; i < files.length; i += READ_DIR_CONCURRENCY) {
    const batch = files.slice(i, i + READ_DIR_CONCURRENCY);
    const pages = await Promise.all(
      batch.map(async (file) => {
        const page = await readJson<CrawledPageWithId>(path.join(dir, file));
        return page ? { ...page, pageId: file.replace(/\.json$/, "") } : null;
      }),
    );
    for (const page of pages) {
      if (page) yield page;
      else skipped++;
    }
  }
  if (skipped > 0) console.warn(`[lib/data] streamPages(${runId}): skipped ${skipped} malformed page file(s)`);
}

/** Every page record of a run. Filtering/sorting is the callers' job — they all want the full set
 *  and narrow it with the client-safe helpers in lib/explorer-shared.ts. */
async function getPagesFromDisk(runId: string): Promise<CrawledPageWithId[]> {
  const stamp = await runStamp(runId);
  const hit = pagesCache.get(runId);
  if (hit && hit.stamp === stamp) {
    pagesCache.delete(runId);
    pagesCache.set(runId, hit);
    return hit.pages;
  }
  const pages = readPagesDir(runId);
  pagesCache.delete(runId);
  pagesCache.set(runId, { stamp, pages });
  if (pagesCache.size > PAGES_CACHE_MAX_RUNS) {
    const lru = pagesCache.keys().next();
    if (!lru.done) pagesCache.delete(lru.value);
  }
  return pages;
}

/** JSON when this machine has the run's files, otherwise reconstruct from Postgres. */
export async function getPages(runId: string): Promise<CrawledPageWithId[]> {
  if (await hasRunOnDisk(runId)) return getPagesFromDisk(runId);
  const dbPages = await dbGetCrawlPages(runId);
  return dbPages ?? [];
}

async function getPageFromDisk(runId: string, pageId: string): Promise<CrawledPageWithId | null> {
  const hit = pagesCache.get(runId);
  // Warm-cache peek only — never triggers a full load just to read one page.
  if (hit && hit.stamp === (await runStamp(runId))) {
    const found = (await hit.pages).find((p) => p.pageId === pageId);
    if (found) return found;
  }
  const page = await readJson<CrawledPageWithId>(path.join(RUNS_DIR, runId, "pages", `${pageId}.json`));
  return page ? { ...page, pageId } : null;
}

export async function getPage(runId: string, pageId: string): Promise<CrawledPageWithId | null> {
  if (await hasRunOnDisk(runId)) return getPageFromDisk(runId, pageId);
  return dbGetCrawlPage(runId, pageId);
}

/** DB-backed stream: pages come materialised from Postgres (no local files), yielded one at a
 *  time for the same caller contract. JSON runs keep the bounded streaming path above. */
export async function* streamPages(runId: string): AsyncGenerator<CrawledPageWithId> {
  if (await hasRunOnDisk(runId)) {
    yield* streamPagesFromDisk(runId);
    return;
  }
  const pages = (await dbGetCrawlPages(runId)) ?? [];
  for (const page of pages) yield page;
}

/** Pure path resolver — no I/O. Caller stats/serves the file (S10 scope). */
export function rawHtmlPath(runId: string, pageId: string): string {
  return path.join(RUNS_DIR, runId, "raw", `${pageId}.html`);
}

/** Trust boundary for callers serving files by id — see app/api/raw's containment check. */
export function runsDir(): string {
  return RUNS_DIR;
}

/** Informational path shown in the sidebar's Help & support item — not guaranteed to exist yet. */
export function getReportPath(): string {
  return path.resolve(STORAGE_ROOT, "..", "POC-1-REPORT.md");
}
