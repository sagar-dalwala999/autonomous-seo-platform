/** Read-only loaders for a run's stored evidence (storage/runs/<runId>/**) — used by evidence-check + poc-report. */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type {
  CrawledPage,
  CrawlSummary,
  FailureRecord,
  RobotsEvidence,
  SitemapResult,
} from "../../src/models/types";
import { RUNS_DIR } from "./paths";

export function runDirFor(runId: string): string {
  return path.join(RUNS_DIR, runId);
}

async function readJsonIfExists<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** Loads every pages/*.json record. Tolerates one-record-per-file or a single array file. */
export async function loadPages(runId: string): Promise<CrawledPage[]> {
  const dir = path.join(runDirFor(runId), "pages");
  let entries: string[];
  try {
    entries = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const pages: CrawledPage[] = [];
  for (const entry of entries) {
    const parsed = await readJsonIfExists<CrawledPage>(path.join(dir, entry));
    if (parsed) pages.push(parsed);
  }
  return pages;
}

export async function loadFailures(runId: string): Promise<FailureRecord[]> {
  const data = await readJsonIfExists<FailureRecord[]>(path.join(runDirFor(runId), "failures.json"));
  return data ?? [];
}

export async function loadBlocked(runId: string): Promise<string[]> {
  const data = await readJsonIfExists<string[]>(path.join(runDirFor(runId), "blocked.json"));
  return data ?? [];
}

export async function loadSitemaps(runId: string): Promise<SitemapResult | null> {
  return readJsonIfExists<SitemapResult>(path.join(runDirFor(runId), "sitemaps.json"));
}

export async function loadRobots(runId: string): Promise<RobotsEvidence | null> {
  return readJsonIfExists<RobotsEvidence>(path.join(runDirFor(runId), "robots.json"));
}

export async function loadReport(runId: string): Promise<CrawlSummary | null> {
  return readJsonIfExists<CrawlSummary>(path.join(runDirFor(runId), "report.json"));
}

/** Pathname of a URL, trailing slash stripped except root — tolerant of normalization differences. */
export function pathnameOf(url: string | null): string | null {
  if (!url) return null;
  try {
    const p = new URL(url).pathname;
    return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
  } catch {
    return null;
  }
}

/** First page matching this pathname by requested identity OR finalUrl — a redirected page's
 * identity is the URL that was asked for (e.g. /old-gear), not its destination. */
export function byPath(pages: CrawledPage[], pathname: string): CrawledPage | undefined {
  return pages.find(
    (p) => pathnameOf(p.normalizedUrl ?? p.url) === pathname || pathnameOf(p.finalUrl) === pathname,
  );
}

export function allByPath(pages: CrawledPage[], pathnames: string[]): CrawledPage[] {
  const set = new Set(pathnames);
  return pages.filter((p) => {
    const requested = pathnameOf(p.normalizedUrl ?? p.url);
    const landed = pathnameOf(p.finalUrl);
    return (requested !== null && set.has(requested)) || (landed !== null && set.has(landed));
  });
}
