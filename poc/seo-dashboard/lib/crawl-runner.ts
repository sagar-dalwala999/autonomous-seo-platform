/**
 * Server-only. Spawns the sibling crawler CLI as a real child process and tracks it via
 * storage/runs/<runId>/.crawl-status.json — the file (not in-memory state) is the source of
 * truth so status survives a dev-server hot-reload of this module.
 *
 * Spawn strategy: `node --import tsx src/index.ts ...` (verified live) instead of `npx tsx`.
 * tsx publishes its loader at its package "." export, so Node's native --import loader hook
 * runs the CLI in a SINGLE process — no npx/cmd.exe wrapper layer, so the PID we capture is the
 * real worker (matters for the pid-alive check below). shell:false + an args array throughout.
 * Deliberately NOT detached: detached strips the console on win32, making console-subsystem
 * grandchildren (chrome-headless-shell) open visible windows; windowsHide provides an invisible
 * console they inherit, and win32 children survive parent exit regardless.
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { openSync, closeSync } from "node:fs";
import path from "node:path";

const CRAWLER_DIR = process.env.CRAWLER_PROJECT_DIR
  ? path.resolve(process.cwd(), process.env.CRAWLER_PROJECT_DIR)
  : path.resolve(process.cwd(), "..", "seo-crawler-poc");

const STORAGE_ROOT = process.env.CRAWLER_STORAGE_DIR
  ? path.resolve(process.cwd(), process.env.CRAWLER_STORAGE_DIR)
  : path.join(CRAWLER_DIR, "storage");

const RUNS_DIR = path.join(STORAGE_ROOT, "runs");

export type CrawlState = "running" | "done" | "failed";

/** Contract mirrors CrawlAuth/CrawlSafety in ../seo-crawler-poc/src/models/types.ts exactly. */
export interface CrawlAuthInput {
  basic: { username: string; password: string } | null;
  cookie: string | null;
  headers: Record<string, string>;
}

export interface CrawlSafetyInput {
  denyLogout: boolean;
  denyDestructive: boolean;
  excludePatterns: string[];
}

export interface CrawlStatus {
  runId: string;
  state: CrawlState;
  pid: number;
  startUrl: string;
  maxPages: number;
  maxDepth: number | null;
  respectRobots: boolean;
  render: "auto" | "never" | "always";
  aliases: string[];
  /** Method only — never the credential values. See "credential hygiene" note in startCrawl. */
  authMethod: "none" | "basic" | "cookie" | "header";
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  note?: string;
}

export interface StartCrawlInput {
  startUrl: string;
  maxPages?: number;
  maxDepth?: number | null;
  respectRobots?: boolean;
  render?: "auto" | "never" | "always";
  aliases?: string[];
  /** Credentials for protected routes; null/undefined = anonymous crawl. Never persisted — see startCrawl. */
  auth?: CrawlAuthInput | null;
  /** Guard rails; only meaningful when auth is present. */
  safety?: CrawlSafetyInput | null;
}

export class CrawlConflictError extends Error {
  constructor(public runningRunId: string) {
    super(`A crawl is already running (${runningRunId}). Only one crawl at a time in this POC.`);
  }
}

export class CrawlValidationError extends Error {}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function newRunId(): string {
  const d = new Date();
  const stamp =
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
  return `ui-${stamp}`;
}

function statusPath(runId: string): string {
  return path.join(RUNS_DIR, runId, ".crawl-status.json");
}

function logPath(runId: string): string {
  return path.join(RUNS_DIR, runId, "crawl.log");
}

async function readStatus(runId: string): Promise<CrawlStatus | null> {
  try {
    return JSON.parse(await readFile(statusPath(runId), "utf8")) as CrawlStatus;
  } catch {
    return null;
  }
}

async function writeStatus(status: CrawlStatus): Promise<void> {
  await mkdir(path.dirname(statusPath(status.runId)), { recursive: true });
  await writeFile(statusPath(status.runId), JSON.stringify(status, null, 2), "utf8");
}

/** Signal 0 does not kill — it only probes existence; Node supports this cross-platform incl. win32. */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function listRunIds(): Promise<string[]> {
  try {
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(RUNS_DIR, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Reconciling read: if the status file says "running" but the pid is dead (server restarted
 * mid-crawl, or the child crashed without the exit handler firing), resolve the truth from disk
 * — report.json present means it finished; absent means it died — and persist the correction.
 */
export async function getCrawlStatus(runId: string): Promise<CrawlStatus | null> {
  const status = await readStatus(runId);
  if (!status) return null;
  if (status.state !== "running") return status;
  if (isPidAlive(status.pid)) return status;

  const reportReady = await fileExists(path.join(RUNS_DIR, runId, "report.json"));
  const reconciled: CrawlStatus = {
    ...status,
    state: reportReady ? "done" : "failed",
    endedAt: new Date().toISOString(),
    exitCode: reportReady ? 0 : null,
    note: "reconciled: process no longer alive (dev-server restart or crash) — inferred from report.json presence",
  };
  await writeStatus(reconciled);
  return reconciled;
}

/** Scans every run dir for a live `running` status. Returns its runId, or null if the coast is clear. */
export async function findRunningCrawl(): Promise<string | null> {
  for (const runId of await listRunIds()) {
    const status = await getCrawlStatus(runId);
    if (status?.state === "running") return runId;
  }
  return null;
}

export async function tailLog(runId: string, maxLines = 30): Promise<string[]> {
  try {
    const text = await readFile(logPath(runId), "utf8");
    const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}

export async function reportReady(runId: string): Promise<boolean> {
  return fileExists(path.join(RUNS_DIR, runId, "report.json"));
}

/** authMethod is derived, never client-supplied — it's the single source of truth for which
 *  branch of CrawlAuthInput is populated, so the display metadata in CrawlStatus can't drift
 *  from what actually got sent to the CLI. */
function deriveAuthMethod(auth: CrawlAuthInput | null | undefined): "none" | "basic" | "cookie" | "header" {
  if (!auth) return "none";
  if (auth.basic) return "basic";
  if (auth.cookie) return "cookie";
  if (Object.keys(auth.headers ?? {}).length > 0) return "header";
  return "none";
}

/** Server-side mirror of the client's validateAuth in app/new-crawl/page.tsx — never trust the client alone. */
function validateAuth(auth: CrawlAuthInput | null | undefined): CrawlAuthInput | null {
  if (!auth) return null;
  const method = deriveAuthMethod(auth);
  if (method === "none") return null;

  if (method === "basic") {
    const username = auth.basic!.username?.trim();
    const password = auth.basic!.password;
    if (!username || !password) throw new CrawlValidationError("Basic auth requires both a username and a password.");
    return { basic: { username, password }, cookie: null, headers: {} };
  }
  if (method === "cookie") {
    const cookie = auth.cookie!.trim();
    if (!cookie) throw new CrawlValidationError("Cookie auth requires a non-empty Cookie header value.");
    return { basic: null, cookie, headers: {} };
  }
  const entries = Object.entries(auth.headers ?? {}).filter(([k, v]) => k.trim() && v);
  if (entries.length === 0) throw new CrawlValidationError("Custom header auth requires a header name and value.");
  return { basic: null, cookie: null, headers: Object.fromEntries(entries) };
}

function validateSafety(safety: CrawlSafetyInput | null | undefined, authActive: boolean): CrawlSafetyInput | null {
  if (!authActive) return null;
  return {
    denyLogout: safety?.denyLogout ?? true,
    denyDestructive: safety?.denyDestructive ?? true,
    excludePatterns: (safety?.excludePatterns ?? []).map((p) => p.trim()).filter(Boolean),
  };
}

function validate(input: StartCrawlInput): {
  url: URL;
  maxPages: number;
  maxDepth: number | null;
  respectRobots: boolean;
  render: "auto" | "never" | "always";
  aliases: string[];
  auth: CrawlAuthInput | null;
  safety: CrawlSafetyInput | null;
} {
  if (!input.startUrl || typeof input.startUrl !== "string") {
    throw new CrawlValidationError("startUrl is required.");
  }
  let url: URL;
  try {
    url = new URL(input.startUrl);
  } catch {
    throw new CrawlValidationError(`"${input.startUrl}" is not a valid URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CrawlValidationError("Only http:// and https:// start URLs are allowed.");
  }

  const maxPagesRaw = input.maxPages ?? 100;
  // 0 = "crawl all pages" sentinel, passed through to the CLI's --max-pages 0 (unlimited).
  const maxPages =
    Number(maxPagesRaw) === 0 ? 0 : Math.min(1_000_000, Math.max(1, Math.floor(Number(maxPagesRaw) || 100)));

  let maxDepth: number | null = null;
  if (input.maxDepth !== undefined && input.maxDepth !== null) {
    const parsed = Math.floor(Number(input.maxDepth));
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new CrawlValidationError("maxDepth must be a non-negative integer when provided.");
    }
    maxDepth = parsed;
  }

  const render = input.render ?? "auto";
  if (render !== "auto" && render !== "never" && render !== "always") {
    throw new CrawlValidationError('render must be "auto", "never", or "always".');
  }

  const aliases = (input.aliases ?? []).map((h) => h.trim()).filter(Boolean);

  const auth = validateAuth(input.auth);
  const safety = validateSafety(input.safety, auth !== null);

  return { url, maxPages, maxDepth, respectRobots: input.respectRobots ?? true, render, aliases, auth, safety };
}

export async function startCrawl(input: StartCrawlInput): Promise<CrawlStatus> {
  const running = await findRunningCrawl();
  if (running) throw new CrawlConflictError(running);

  const { url, maxPages, maxDepth, respectRobots, render, aliases, auth, safety } = validate(input);

  const isLocal = url.hostname === "localhost" || /^127\./.test(url.hostname);
  const rps = isLocal ? 10 : 2;
  const runId = newRunId();

  const args = [
    "--import",
    "tsx",
    "src/index.ts",
    url.toString(),
    "--max-pages",
    String(maxPages),
    "--render",
    render,
    "--rps",
    String(rps),
    "--run-id",
    runId,
    "--out",
    "storage",
  ];
  if (!respectRobots) args.push("--no-robots");
  if (aliases.length > 0) args.push("--alias", aliases.join(","));
  if (maxDepth !== null) args.push("--max-depth", String(maxDepth));

  // Credential hygiene: these values only ever flow into `args`, handed straight to spawn()'s
  // argv array below — never console.log'd, never JSON.stringify'd into status/log files. See
  // writeStatus() and CrawlStatus.authMethod (method name only, no secret values).
  if (auth?.basic) args.push("--basic-auth", `${auth.basic.username}:${auth.basic.password}`);
  if (auth?.cookie) args.push("--cookie", auth.cookie);
  if (auth) for (const [name, value] of Object.entries(auth.headers)) args.push("--header", `${name}: ${value}`);
  if (safety) {
    // CLI takes ONE --exclude flag as a comma-separated list (src/index.ts: values.exclude.split(",")),
    // not repeated flags — repeating it would silently drop all but the last pattern.
    if (safety.excludePatterns.length > 0) args.push("--exclude", safety.excludePatterns.join(","));
    if (!safety.denyLogout && !safety.denyDestructive) args.push("--no-safety");
  }

  await mkdir(path.join(RUNS_DIR, runId), { recursive: true });
  const fd = openSync(logPath(runId), "a");

  // NOT detached: on Windows, detached (DETACHED_PROCESS) strips the console entirely, so
  // console-subsystem grandchildren (chrome-headless-shell.exe) allocate a NEW VISIBLE console.
  // windowsHide (CREATE_NO_WINDOW) gives this child an invisible console that Chromium inherits.
  // Win32 children survive parent exit regardless, so crawls outlive server restarts either way.
  const child = spawn(process.execPath, args, {
    windowsHide: true,
    cwd: CRAWLER_DIR,
    shell: false,
    stdio: ["ignore", fd, fd],
    env: process.env,
  });
  closeSync(fd);

  if (!child.pid) {
    throw new Error("Failed to spawn crawler process (no pid).");
  }

  const status: CrawlStatus = {
    runId,
    state: "running",
    pid: child.pid,
    startUrl: url.toString(),
    maxPages,
    maxDepth,
    respectRobots,
    render,
    aliases,
    authMethod: deriveAuthMethod(auth),
    startedAt: new Date().toISOString(),
    endedAt: null,
    exitCode: null,
  };
  await writeStatus(status);

  child.on("exit", (code) => {
    void writeStatus({
      ...status,
      state: code === 0 || code === 2 ? "done" : "failed",
      endedAt: new Date().toISOString(),
      exitCode: code,
    });
    if (code === 0 || code === 2) spawnAnalyze(runId);
  });
  child.unref();

  return status;
}

/**
 * Post-crawl auto-analyze (A5): same windowsHide non-detached spawn discipline as the crawl
 * itself (see file header) — a spawn/exit failure here is only logged to crawl.log, never thrown,
 * so the analyzer can never flip a successful crawl's status to failed.
 */
function spawnAnalyze(runId: string): void {
  try {
    const fd = openSync(logPath(runId), "a");
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
  } catch {
    // best-effort — never let this surface as a crawl failure
  }
}
