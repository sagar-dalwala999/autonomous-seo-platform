/**
 * Build (optional) + serve ../target-site on a free port, poll until it answers, record PID+port.
 * Usage: tsx scripts/serve-target-site.ts [--port 3105] [--skip-build]
 */
import { parseArgs } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PROJECT_ROOT, STORAGE_DIR, TARGET_SITE_DIR, TARGET_SITE_STATE_FILE, TARGET_SITE_PORT_FILE } from "./lib/paths";
import { runToLog, spawnDetached, isPortFree, waitForHttp } from "./lib/proc";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "3105" },
    "skip-build": { type: "boolean", default: false },
  },
});

async function findFreePort(preferred: number): Promise<number> {
  let port = preferred;
  for (let i = 0; i < 20; i++) {
    if (await isPortFree(port)) return port;
    console.log(`port ${port} busy (leaving it alone) — trying ${port + 1}`);
    port += 1;
  }
  throw new Error(`no free port found starting at ${preferred}`);
}

async function main(): Promise<void> {
  const requestedPort = Number(values.port);
  const skipBuild = Boolean(values["skip-build"]);
  const serverLogDir = path.join(STORAGE_DIR, "bench", "server-logs");
  await mkdir(serverLogDir, { recursive: true });

  const port = await findFreePort(requestedPort);
  await writeFile(TARGET_SITE_PORT_FILE, String(port), "utf8");

  if (!skipBuild) {
    console.log(`building target-site (npm run build)...`);
    const buildLog = path.join(serverLogDir, "build.log");
    const build = await runToLog("npm", ["run", "build"], { cwd: TARGET_SITE_DIR, logFile: buildLog });
    if (build.exitCode !== 0) {
      throw new Error(`target-site build failed (exit ${build.exitCode}) — see ${buildLog}`);
    }
    console.log(`build OK — log at ${buildLog}`);
  } else {
    console.log("--skip-build passed, reusing existing .next");
  }

  const startLog = path.join(serverLogDir, `start-${port}.log`);
  // Spawn node directly on next's CLI script (no npx/cmd.exe wrapper): a shelled-out `npx next
  // start` wrapper process can exit almost immediately while a grandchild keeps the server alive,
  // which recorded the WRONG (short-lived) pid and made stop-target-site.ts a no-op. Verified live.
  const nextBin = path.join(TARGET_SITE_DIR, "node_modules", "next", "dist", "bin", "next");
  const child = spawnDetached(process.execPath, [nextBin, "start", "-p", String(port)], {
    cwd: TARGET_SITE_DIR,
    logFile: startLog,
    shell: false,
  });
  if (!child.pid) throw new Error("failed to spawn `next start` — no PID returned");

  const rootUrl = `http://localhost:${port}/`;
  console.log(`waiting for ${rootUrl} (60s timeout)...`);
  const probe = await waitForHttp(rootUrl, 60_000);
  if (!probe.ok) {
    child.kill("SIGTERM");
    throw new Error(`target-site did not respond at ${rootUrl} within 60s — see ${startLog}`);
  }

  const state = {
    pid: child.pid,
    port,
    startUrl: rootUrl,
    startedAt: new Date().toISOString(),
    logFile: startLog,
    cwd: TARGET_SITE_DIR,
    stopped: false,
  };
  await writeFile(TARGET_SITE_STATE_FILE, JSON.stringify(state, null, 2), "utf8");

  console.log(`target-site is up: ${rootUrl} (status ${probe.status}, pid ${child.pid}, ${probe.elapsedMs}ms)`);
  console.log(`state written to ${path.relative(PROJECT_ROOT, TARGET_SITE_STATE_FILE)}`);
  console.log(`stop it with: npx tsx scripts/stop-target-site.ts`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
