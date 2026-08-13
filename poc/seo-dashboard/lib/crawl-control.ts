/**
 * Server-only. Additive sibling of lib/crawl-runner.ts (do-not-touch, owns startCrawl et al.):
 * cancel / rerun / reanalyze / label metadata for a tracked crawl. Reads the same
 * .crawl-status.json the runner writes; never imports crawl-runner's private spawn internals.
 */
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { spawn } from "node:child_process";
import { openSync, closeSync } from "node:fs";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import type { CrawlStatus, StartCrawlInput } from "./crawl-runner";

const execAsync = promisify(exec);

const CRAWLER_DIR = process.env.CRAWLER_PROJECT_DIR
  ? path.resolve(process.cwd(), process.env.CRAWLER_PROJECT_DIR)
  : path.resolve(process.cwd(), "..", "seo-crawler-poc");

const STORAGE_ROOT = process.env.CRAWLER_STORAGE_DIR
  ? path.resolve(process.cwd(), process.env.CRAWLER_STORAGE_DIR)
  : path.join(CRAWLER_DIR, "storage");

const RUNS_DIR = path.join(STORAGE_ROOT, "runs");

function statusPath(runId: string): string {
  return path.join(RUNS_DIR, runId, ".crawl-status.json");
}

function metaPath(runId: string): string {
  return path.join(RUNS_DIR, runId, ".dashboard-meta.json");
}

async function readStatus(runId: string): Promise<CrawlStatus | null> {
  try {
    return JSON.parse(await readFile(statusPath(runId), "utf8")) as CrawlStatus;
  } catch {
    return null;
  }
}

async function writeStatus(status: CrawlStatus): Promise<void> {
  await writeFile(statusPath(status.runId), JSON.stringify(status, null, 2), "utf8");
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class CancelError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/**
 * Real cancellation, not a client-side no-op (PLAN-03 §2.4 names Jemish's EventSource.close()
 * defect explicitly — this must not repeat it). `taskkill /T` on win32 kills the whole process
 * tree so the tsx-hosted CLI's own headless-browser children die too, not just the parent pid.
 * There is no in-flight-batch abort signal in this POC crawler, so the crawl stops at the OS
 * level rather than at a frontier-batch boundary — the run is left `partial: true`-equivalent by
 * the fact that report.json is never produced; the status file carries that honestly as its own
 * `cancelled` CrawlState (distinct from `failed` — a user stopping a crawl on purpose isn't a
 * failure), with the note kept as human-readable detail, not the only place the fact lives.
 */
export async function cancelCrawl(runId: string): Promise<CrawlStatus> {
  const status = await readStatus(runId);
  if (!status) throw new CancelError(`No crawl status found for runId "${runId}".`, 404);
  if (status.state !== "running") throw new CancelError(`Crawl "${runId}" is not running (state: ${status.state}).`, 409);
  if (!isPidAlive(status.pid)) throw new CancelError(`Crawl "${runId}" has no live process to cancel.`, 409);

  if (process.platform === "win32") {
    await execAsync(`taskkill /PID ${status.pid} /T /F`).catch(() => {
      // Best-effort: pid may exit between the isPidAlive check and this call — treat as already gone.
    });
  } else {
    try {
      process.kill(-status.pid, "SIGTERM");
    } catch {
      try {
        process.kill(status.pid, "SIGTERM");
      } catch {
        // already gone
      }
    }
  }

  const cancelled: CrawlStatus = {
    ...status,
    state: "cancelled",
    endedAt: new Date().toISOString(),
    exitCode: null,
    note: "cancelled by user request (POST /crawls/:id/cancel) — process tree killed before completion",
  };
  await writeStatus(cancelled);
  return cancelled;
}

/** Re-runs the same seed/config recorded on the original crawl's status file. Auth credentials
 *  are never persisted to that file (see crawl-runner.ts's "credential hygiene" note), so a rerun
 *  of an authenticated crawl drops auth — documented limitation, not a silent bug. */
export async function rerunCrawl(runId: string): Promise<StartCrawlInput> {
  const status = await readStatus(runId);
  if (!status) throw new CancelError(`No crawl status found for runId "${runId}".`, 404);
  return {
    startUrl: status.startUrl,
    maxPages: status.maxPages,
    maxDepth: status.maxDepth,
    respectRobots: status.respectRobots,
    render: status.render,
    screenshots: status.screenshots,
    aliases: status.aliases,
  };
}

/** Mirrors crawl-runner.ts's spawnAnalyze spawn discipline exactly (windowsHide, non-detached,
 *  stdio->crawl.log, unref) so a reanalyze looks identical in the log to the post-crawl auto-run. */
export async function reanalyzeCrawl(runId: string): Promise<{ started: true }> {
  const runDir = path.join(RUNS_DIR, runId);
  try {
    await stat(runDir);
  } catch {
    throw new CancelError(`No run directory found for "${runId}".`, 404);
  }
  const fd = openSync(path.join(runDir, "crawl.log"), "a");
  const child = spawn(process.execPath, ["--import", "tsx", "src/analysis/cli.ts", "--run", runId], {
    windowsHide: true,
    cwd: CRAWLER_DIR,
    shell: false,
    stdio: ["ignore", fd, fd],
    env: process.env,
  });
  closeSync(fd);
  child.on("error", () => {});
  child.unref();
  return { started: true };
}

export interface RunMeta {
  label: string | null;
  notes: string | null;
  tags: string[];
}

export async function readRunMeta(runId: string): Promise<RunMeta> {
  try {
    return JSON.parse(await readFile(metaPath(runId), "utf8")) as RunMeta;
  } catch {
    return { label: null, notes: null, tags: [] };
  }
}

export async function writeRunMeta(runId: string, patch: Partial<RunMeta>): Promise<RunMeta> {
  const current = await readRunMeta(runId);
  const next: RunMeta = {
    label: patch.label !== undefined ? patch.label : current.label,
    notes: patch.notes !== undefined ? patch.notes : current.notes,
    tags: patch.tags !== undefined ? patch.tags : current.tags,
  };
  await mkdir(path.dirname(metaPath(runId)), { recursive: true });
  await writeFile(metaPath(runId), JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function runsDirPath(): string {
  return RUNS_DIR;
}
