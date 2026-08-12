/** Slice C4 implements: npm run diff -- --base <runId> --head <runId> [--out storage] */
import { mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import path from "node:path";
import { diffRuns } from "./crawlDiff";
import type { CrawlDiff } from "../models/types";

const HELP_TEXT = `
seo-crawler-poc diff — crawl-over-crawl comparison between two stored runs

Usage:
  npm run diff -- --base <runId> --head <runId> [options]

Options:
  --base ID       Baseline run identifier under storage/runs/ (required)
  --head ID       Comparison run identifier under storage/runs/ (required)
  --out DIR       Storage root both runs live under (default: storage)
  -h, --help      Show this help

Writes storage/diffs/<base>__<head>.json and prints a readable summary.
`.trim();

function printSummary(diff: CrawlDiff): void {
  console.log(`\nDiff: ${diff.baseRunId} -> ${diff.headRunId}`);
  console.log(
    `  added: ${diff.added.length} | removed: ${diff.removed.length} | changed: ${diff.changed.length} | unchanged: ${diff.unchangedCount}`,
  );
  console.log(
    diff.issues
      ? `  issues: ${diff.issues.newIssues.length} new, ${diff.issues.fixedIssues.length} fixed, ${diff.issues.persistingCount} persisting`
      : "  issues: not available — both runs need issues.json (npm run analyze) to compute the lifecycle",
  );

  if (diff.changed.length > 0) {
    console.log("  top changed URLs:");
    for (const c of diff.changed.slice(0, 10)) {
      console.log(`    ${c.url}`);
      for (const ch of c.changes) console.log(`      ${ch.field}: ${JSON.stringify(ch.before)} -> ${JSON.stringify(ch.after)}`);
    }
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      base: { type: "string" },
      head: { type: "string" },
      out: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  const { base, head } = values;
  if (!base || !head) {
    console.error("Error: missing --base <runId> and/or --head <runId>.\n");
    console.log(HELP_TEXT);
    process.exit(1);
    return;
  }

  const outDir = values.out ?? "storage";
  const baseRunDir = path.resolve(outDir, "runs", base);
  const headRunDir = path.resolve(outDir, "runs", head);

  console.log(`Comparing runs: ${base} -> ${head}`);
  console.log(`  base: ${baseRunDir}`);
  console.log(`  head: ${headRunDir}`);

  const diff = await diffRuns(baseRunDir, headRunDir);

  const diffsDir = path.resolve(outDir, "diffs");
  await mkdir(diffsDir, { recursive: true });
  const outFile = path.join(diffsDir, `${base}__${head}.json`);
  await writeFile(outFile, JSON.stringify(diff, null, 2), "utf8");
  console.log(`  wrote ${outFile}`);

  printSummary(diff);
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
