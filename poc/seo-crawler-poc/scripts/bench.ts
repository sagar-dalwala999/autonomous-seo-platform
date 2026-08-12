/**
 * Runs the brief §4 test matrix via the CLI, capturing each run's log + report.json.
 * Usage: tsx scripts/bench.ts [--only name[,name]] [--skip-external] [--port 3105] [--timeout-ms 600000]
 *
 * Assumed CLI flags on `npm run crawl --` (owned by S4, not yet built at the time this was
 * written): --max-pages, --no-robots, --alias <host,host>, --render, --rps <n>, --run-id <id>.
 * --run-id and --rps map 1:1 onto CrawlOptions.runId / maxRequestsPerSecond (src/models/types.ts).
 * If S4 lands with different flag names, bench.ts's TARGETS[].args need a one-line update.
 */
import { parseArgs } from "node:util";
import { mkdir, copyFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { PROJECT_ROOT, BENCH_DIR, TARGET_SITE_STATE_FILE, RUNS_DIR } from "./lib/paths";
import { runToLog } from "./lib/proc";
import { makeStamp } from "./lib/stamp";

interface Target {
  name: string;
  external: boolean;
  args: (port: number) => string[];
  timeoutMs: number;
  proves: string;
}

const TARGETS: Target[] = [
  {
    name: "target-full",
    external: false,
    proves: "extraction evidence completeness (--no-robots, 18-item manifest)",
    args: (port) => [
      `http://localhost:${port}`,
      "--no-robots",
      "--alias",
      "summittrailgear.example,www.summittrailgear.example",
      "--max-pages",
      "100",
    ],
    timeoutMs: 5 * 60_000,
  },
  {
    name: "target-robots",
    external: false,
    proves: "robots.txt blocking (/guides/* → blocked.json, manifest #13)",
    args: (port) => [
      `http://localhost:${port}`,
      "--alias",
      "summittrailgear.example,www.summittrailgear.example",
      "--max-pages",
      "100",
    ],
    timeoutMs: 5 * 60_000,
  },
  {
    name: "redirect-chain",
    external: false,
    proves: "2-hop redirect chain capture (/old-gear, manifest #16)",
    args: (port) => [`http://localhost:${port}/old-gear`, "--no-robots", "--max-pages", "5"],
    timeoutMs: 2 * 60_000,
  },
  {
    name: "redirect-loop",
    external: false,
    proves: "redirect-loop classification (/loop-a, manifest #16)",
    args: (port) => [`http://localhost:${port}/loop-a`, "--no-robots", "--max-pages", "5"],
    timeoutMs: 2 * 60_000,
  },
  {
    name: "books",
    external: true,
    proves: "static crawl at scale, pagination, coverage math",
    args: () => ["https://books.toscrape.com", "--max-pages", "150", "--rps", "2"],
    timeoutMs: 10 * 60_000,
  },
  {
    name: "quotes-js",
    external: true,
    proves: "JS-detection + Playwright escalation on a CSR page",
    args: () => ["https://quotes.toscrape.com/js/", "--max-pages", "30", "--rps", "2"],
    timeoutMs: 8 * 60_000,
  },
  {
    name: "example",
    external: true,
    proves: "smoke test",
    args: () => ["https://example.com", "--max-pages", "5", "--rps", "2"],
    timeoutMs: 60_000,
  },
];

const { values } = parseArgs({
  options: {
    only: { type: "string" },
    "skip-external": { type: "boolean", default: false },
    port: { type: "string" },
    "timeout-ms": { type: "string" },
  },
});

async function resolvePort(): Promise<number> {
  if (values.port) return Number(values.port);
  try {
    const state = JSON.parse(await (await import("node:fs/promises")).readFile(TARGET_SITE_STATE_FILE, "utf8"));
    return state.port ?? 3105;
  } catch {
    return 3105;
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const port = await resolvePort();
  const onlyFilter = values.only ? new Set(values.only.split(",").map((s) => s.trim())) : null;
  const skipExternal = Boolean(values["skip-external"]);
  const timeoutOverride = values["timeout-ms"] ? Number(values["timeout-ms"]) : null;

  const stamp = makeStamp();
  const benchDir = path.join(BENCH_DIR, stamp);
  await mkdir(benchDir, { recursive: true });

  const npmCmd = process.platform === "win32" ? "npm" : "npm";
  const manifestEntries: Record<string, unknown>[] = [];

  for (const target of TARGETS) {
    if (onlyFilter && !onlyFilter.has(target.name)) {
      manifestEntries.push({ name: target.name, skipped: true, skipReason: "excluded by --only" });
      continue;
    }
    if (target.external && skipExternal) {
      console.log(`[skip] ${target.name} (external, --skip-external passed)`);
      manifestEntries.push({ name: target.name, skipped: true, skipReason: "--skip-external", external: true });
      continue;
    }

    const runId = `${stamp}-${target.name}`;
    const args = [...target.args(port), "--run-id", runId];
    const logFile = path.join(benchDir, `${target.name}.log`);
    const reportFile = path.join(benchDir, `${target.name}.report.json`);

    console.log(`[run] ${target.name} — runId=${runId}`);
    console.log(`      npm run crawl -- ${args.join(" ")}`);
    const startedAt = new Date().toISOString();
    let result: { exitCode: number | null; timedOut: boolean };
    try {
      result = await runToLog(npmCmd, ["run", "crawl", "--", ...args], {
        cwd: PROJECT_ROOT,
        logFile,
        timeoutMs: timeoutOverride ?? target.timeoutMs,
      });
    } catch (err) {
      result = { exitCode: -1, timedOut: false };
      console.error(`[error] ${target.name}: ${String(err)}`);
    }
    const finishedAt = new Date().toISOString();

    const runReportPath = path.join(RUNS_DIR, runId, "report.json");
    let reportFound = false;
    if (await fileExists(runReportPath)) {
      await copyFile(runReportPath, reportFile);
      reportFound = true;
    }

    console.log(
      `[done] ${target.name} — exit ${result.exitCode}${result.timedOut ? " (TIMED OUT)" : ""}, report ${reportFound ? "copied" : "MISSING"}`
    );

    manifestEntries.push({
      name: target.name,
      external: target.external,
      proves: target.proves,
      runId,
      args,
      skipped: false,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      logFile: path.relative(PROJECT_ROOT, logFile),
      reportFile: reportFound ? path.relative(PROJECT_ROOT, reportFile) : null,
      reportFound,
      startedAt,
      finishedAt,
    });
  }

  const manifestPath = path.join(benchDir, "manifest.json");
  await writeFile(manifestPath, JSON.stringify({ stamp, port, targets: manifestEntries }, null, 2), "utf8");
  console.log(`\nmanifest written to ${path.relative(PROJECT_ROOT, manifestPath)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
