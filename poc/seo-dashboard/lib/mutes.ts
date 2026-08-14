/**
 * Server-only. Mirrors ../seo-crawler-poc/src/analysis/priority/muteStore.ts's file format and
 * path exactly (storage/mutes/<sanitized-site-key>.json) — duplicated rather than imported, same
 * reason as lib/types.ts (no cross-package TS project boundary in this POC, see that file's header
 * comment). engine.ts reads this same file via loadSiteMutes, so a mute written here is picked up
 * the moment the rules engine re-runs.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { openSync, closeSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import type { MuteRecord } from "./types";

const CRAWLER_DIR = process.env.CRAWLER_PROJECT_DIR
  ? path.resolve(process.cwd(), process.env.CRAWLER_PROJECT_DIR)
  : path.resolve(process.cwd(), "..", "seo-crawler-poc");

const STORAGE_ROOT = process.env.CRAWLER_STORAGE_DIR
  ? path.resolve(process.cwd(), process.env.CRAWLER_STORAGE_DIR)
  : path.join(CRAWLER_DIR, "storage");

const RUNS_DIR = path.join(STORAGE_ROOT, "runs");

export function siteKeyFromStartUrl(startUrl: string | null | undefined): string | null {
  if (!startUrl) return null;
  try {
    return new URL(startUrl).host.toLowerCase();
  } catch {
    return null;
  }
}

function sanitize(key: string): string {
  return key.replace(/[^a-z0-9.-]/gi, "_");
}

function muteFile(siteKey: string): string {
  return path.join(STORAGE_ROOT, "mutes", `${sanitize(siteKey)}.json`);
}

async function readRecords(file: string): Promise<MuteRecord[]> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as MuteRecord[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export async function muteRule(siteKey: string, ruleId: string, opts?: { note?: string; mutedBy?: string }): Promise<void> {
  const file = muteFile(siteKey);
  await mkdir(path.dirname(file), { recursive: true });
  const next = (await readRecords(file)).filter((r) => r.ruleId !== ruleId);
  next.push({
    ruleId,
    note: opts?.note ?? null,
    mutedBy: opts?.mutedBy ?? null,
    mutedAt: new Date().toISOString(),
    expiresAt: null,
  });
  next.sort((a, b) => a.ruleId.localeCompare(b.ruleId));
  await writeFile(file, JSON.stringify(next, null, 2), "utf8");
}

export async function unmuteRule(siteKey: string, ruleId: string): Promise<void> {
  const file = muteFile(siteKey);
  const records = await readRecords(file);
  const next = records.filter((r) => r.ruleId !== ruleId);
  if (next.length === records.length) return;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(next, null, 2), "utf8");
}

/**
 * Runs the same analysis CLI lib/crawl-control.ts's reanalyzeCrawl spawns, but AWAITED instead of
 * fire-and-forget: a mute/unmute needs the health score and findings recomputed before the API
 * responds, so the client's next read (a router.refresh()) sees the new state immediately instead
 * of racing a background process.
 */
export async function reanalyzeAndWait(runId: string, timeoutMs = 120_000): Promise<void> {
  const runDir = path.join(RUNS_DIR, runId);
  const fd = openSync(path.join(runDir, "crawl.log"), "a");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/analysis/cli.ts", "--run", runId], {
      windowsHide: true,
      cwd: CRAWLER_DIR,
      shell: false,
      stdio: ["ignore", fd, fd],
      env: process.env,
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`reanalyze timed out after ${timeoutMs}ms for run "${runId}"`));
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`reanalyze exited with code ${code} for run "${runId}" — see storage/runs/${runId}/crawl.log`));
    });
  }).finally(() => closeSync(fd));
}
