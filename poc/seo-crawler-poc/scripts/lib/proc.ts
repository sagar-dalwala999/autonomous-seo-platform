/** Process spawn + HTTP polling helpers shared by serve/stop/bench scripts. */
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, openSync, closeSync } from "node:fs";
import net from "node:net";

export interface RunResult {
  exitCode: number | null;
  timedOut: boolean;
}

/** Spawns `cmd` with args, tees stdout+stderr to `logFile`, resolves with exit code. */
export function runToLog(
  cmd: string,
  args: string[],
  opts: { cwd: string; logFile: string; timeoutMs?: number; env?: NodeJS.ProcessEnv }
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const log = createWriteStream(opts.logFile, { flags: "a" });
    log.write(`$ ${cmd} ${args.join(" ")}\n\n`);
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      shell: true,
      env: opts.env ?? process.env,
    });
    let timedOut = false;
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, opts.timeoutMs)
      : null;
    child.stdout?.on("data", (chunk) => log.write(chunk));
    child.stderr?.on("data", (chunk) => log.write(chunk));
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      log.write(`\n[spawn error] ${String(err)}\n`);
      log.end();
      reject(err);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      log.write(`\n[exit code] ${code}${timedOut ? " (timed out, killed)" : ""}\n`);
      log.end();
      resolve({ exitCode: code, timedOut });
    });
  });
}

/**
 * Spawns a detached long-running server process (survives this script's exit).
 * Writes the child's output straight to a file descriptor (NOT a piped stream) — piping through
 * this process would keep its event loop alive forever waiting to drain the pipe, so the parent
 * script would never exit even after unref().
 */
export function spawnDetached(
  cmd: string,
  args: string[],
  opts: { cwd: string; logFile: string; env?: NodeJS.ProcessEnv; shell?: boolean }
): ChildProcess {
  const fd = openSync(opts.logFile, "a");
  const child = spawn(cmd, args, {
    cwd: opts.cwd,
    shell: opts.shell ?? true,
    // detached:true is required on win32 too — without it the child stays attached to this
    // process's console and gets torn down when the console session ends. Verified live: a
    // detached:false child (same fd-stdio setup) died the instant the spawning script exited;
    // detached:true survived across separate shell invocations.
    detached: true,
    stdio: ["ignore", fd, fd],
    env: opts.env ?? process.env,
  });
  closeSync(fd);
  child.unref();
  return child;
}

export async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once("error", () => resolve(false))
      .once("listening", () => tester.close(() => resolve(true)))
      .listen(port, "127.0.0.1");
  });
}

/** Polls `url` until it returns any HTTP response (any status = server is up) or times out. */
export async function waitForHttp(
  url: string,
  timeoutMs: number,
  intervalMs = 500
): Promise<{ ok: boolean; status: number | null; elapsedMs: number }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      return { ok: true, status: res.status, elapsedMs: Date.now() - start };
    } catch {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  return { ok: false, status: null, elapsedMs: Date.now() - start };
}
