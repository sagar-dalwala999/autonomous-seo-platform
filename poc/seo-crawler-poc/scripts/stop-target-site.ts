/**
 * Stops ONLY the PID recorded by serve-target-site.ts, after verifying its command line
 * actually looks like a next/node process. Never touches a PID we didn't record.
 * Usage: tsx scripts/stop-target-site.ts
 */
import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { TARGET_SITE_STATE_FILE } from "./lib/paths";

interface TargetSiteState {
  pid: number;
  port: number;
  startUrl: string;
  startedAt: string;
  logFile: string;
  cwd: string;
  stopped: boolean;
}

function execCapture(cmd: string, args: string[]): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { shell: false });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout }));
  });
}

async function getCommandLine(pid: number): Promise<string | null> {
  if (process.platform === "win32") {
    const ps = `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`;
    const { stdout } = await execCapture("powershell", ["-NoProfile", "-Command", ps]);
    return stdout.trim() || null;
  }
  try {
    const { stdout } = await execCapture("ps", ["-p", String(pid), "-o", "command="]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  let state: TargetSiteState;
  try {
    state = JSON.parse(await readFile(TARGET_SITE_STATE_FILE, "utf8"));
  } catch {
    console.log("no scripts/.target-site.json — nothing to stop");
    return;
  }

  if (state.stopped) {
    console.log(`pid ${state.pid} already marked stopped in ${TARGET_SITE_STATE_FILE}`);
    return;
  }

  const cmdLine = await getCommandLine(state.pid);
  if (!cmdLine) {
    console.log(`pid ${state.pid} is not running (or command line unreadable) — nothing to kill`);
    await writeFile(TARGET_SITE_STATE_FILE, JSON.stringify({ ...state, stopped: true, stoppedAt: new Date().toISOString(), note: "pid not found" }, null, 2));
    return;
  }

  const looksLikeOurServer = /next|node/i.test(cmdLine) && cmdLine.includes(String(state.port));
  if (!/next|node/i.test(cmdLine)) {
    console.error(`refusing to kill pid ${state.pid} — command line does not look like next/node: "${cmdLine}"`);
    process.exit(1);
  }
  if (!cmdLine.includes(String(state.port))) {
    console.warn(`pid ${state.pid} command line does not mention port ${state.port} (may have been recycled): "${cmdLine}" — killing anyway since it is next/node and this is the PID we recorded`);
  }

  console.log(`stopping pid ${state.pid} (${cmdLine.slice(0, 120)}${cmdLine.length > 120 ? "..." : ""})`);
  if (process.platform === "win32") {
    await execCapture("taskkill", ["/PID", String(state.pid), "/T", "/F"]);
  } else {
    try {
      process.kill(state.pid, "SIGTERM");
    } catch (err) {
      console.warn(`SIGTERM failed: ${String(err)}`);
    }
  }

  await writeFile(
    TARGET_SITE_STATE_FILE,
    JSON.stringify({ ...state, stopped: true, stoppedAt: new Date().toISOString(), verifiedLookedLike: looksLikeOurServer }, null, 2)
  );
  console.log(`pid ${state.pid} stopped`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
