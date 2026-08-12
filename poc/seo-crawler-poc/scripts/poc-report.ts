/**
 * Assembles POC-1-REPORT.md at project root from the latest storage/bench/<stamp> outputs.
 * Usage: tsx scripts/poc-report.ts [--bench-dir storage/bench/<stamp>]
 */
import { parseArgs } from "node:util";
import { readdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import type { CrawlSummary } from "../src/models/types";
import { BENCH_DIR, POC_REPORT_FILE, PROJECT_ROOT } from "./lib/paths";

interface ManifestTarget {
  name: string;
  external?: boolean;
  proves?: string;
  runId?: string;
  skipped: boolean;
  skipReason?: string;
  exitCode?: number | null;
  timedOut?: boolean;
  reportFile?: string | null;
  reportFound?: boolean;
}

interface Manifest {
  stamp: string;
  port: number;
  targets: ManifestTarget[];
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function findLatestBenchDir(): Promise<string | null> {
  try {
    const entries = await readdir(BENCH_DIR, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory() && e.name !== "server-logs" && e.name !== "no-run-data").map((e) => e.name).sort();
    const last = dirs.at(-1);
    return last ? path.join(BENCH_DIR, last) : null;
  } catch {
    return null;
  }
}

function fmtDuration(ms: number | undefined): string {
  if (ms === undefined || Number.isNaN(ms)) return "n/a";
  return `${(ms / 1000).toFixed(1)}s`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { "bench-dir": { type: "string" } } });
  const benchDir = values["bench-dir"] ? path.resolve(values["bench-dir"]) : await findLatestBenchDir();

  const lines: string[] = [];
  lines.push("# POC-1 Report — SEO Crawler");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Node: ${process.version} | Platform: ${process.platform}`);
  lines.push("");

  if (!benchDir) {
    lines.push("## No bench run found");
    lines.push("");
    lines.push("`storage/bench/<stamp>/` does not exist — run `tsx scripts/bench.ts` first, then re-run this script.");
    await writeFile(POC_REPORT_FILE, lines.join("\n"), "utf8");
    console.log(`written (no bench data) to ${POC_REPORT_FILE}`);
    return;
  }

  let manifest: Manifest | null = null;
  try {
    manifest = JSON.parse(await readFile(path.join(benchDir, "manifest.json"), "utf8"));
  } catch {
    lines.push(`## manifest.json missing in ${path.relative(PROJECT_ROOT, benchDir)}`);
  }

  lines.push(`Bench run: \`${path.relative(PROJECT_ROOT, benchDir)}\``);
  lines.push("");

  if (manifest) {
    lines.push("## Per-target coverage");
    lines.push("");
    lines.push("| Target | Attempted | Successful | Failed | Blocked | JS-rendered | Duration | Coverage % |");
    lines.push("|---|---|---|---|---|---|---|---|");
    for (const t of manifest.targets) {
      if (t.skipped) {
        lines.push(`| ${t.name} | — | — | — | — | — | — | skipped (${t.skipReason}) |`);
        continue;
      }
      let report: CrawlSummary | null = null;
      if (t.reportFile) {
        try {
          report = JSON.parse(await readFile(path.join(PROJECT_ROOT, t.reportFile), "utf8"));
        } catch {
          report = null;
        }
      }
      if (!report) {
        lines.push(`| ${t.name} | — | — | — | — | — | — | report.json missing (exit ${t.exitCode}${t.timedOut ? ", TIMED OUT" : ""}) |`);
        continue;
      }
      lines.push(
        `| ${t.name} | ${report.attempted} | ${report.successful} | ${report.failed} | ${report.blockedByRobots} | ${report.jsRendered} | ${fmtDuration(report.durationMs)} | ${report.coveragePercent}% |`
      );
    }
    lines.push("");
  }

  const evidencePath = path.join(benchDir, "evidence.md");
  if (await fileExists(evidencePath)) {
    lines.push("## Seeded-evidence checklist");
    lines.push("");
    lines.push(await readFile(evidencePath, "utf8"));
    lines.push("");
  } else {
    lines.push("## Seeded-evidence checklist");
    lines.push("");
    lines.push("Not run — `tsx scripts/evidence-check.ts` has not produced `evidence.md` for this bench run yet.");
    lines.push("");
  }

  lines.push("## Not verified / known limitations");
  lines.push("");
  const limitations: string[] = [];
  if (manifest) {
    for (const t of manifest.targets) {
      if (t.skipped) limitations.push(`- **${t.name}** skipped: ${t.skipReason}`);
      else if (t.reportFound === false) limitations.push(`- **${t.name}** ran (exit ${t.exitCode}) but produced no report.json — inspect ${t.reportFile ?? "its log"}`);
      else if (t.timedOut) limitations.push(`- **${t.name}** hit its bench timeout and was killed`);
    }
  } else {
    limitations.push("- No manifest.json — bench run state unknown.");
  }
  if (limitations.length === 0) limitations.push("- None recorded — every matrix target produced a report.json.");
  lines.push(...limitations);
  lines.push("");
  lines.push(
    "This report is auto-assembled from `storage/bench/<stamp>/manifest.json` + `evidence.md`. It reports only what those files contain — it does not re-verify crawl correctness beyond the seeded-evidence checklist above."
  );

  await writeFile(POC_REPORT_FILE, lines.join("\n"), "utf8");
  console.log(`written to ${POC_REPORT_FILE}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
