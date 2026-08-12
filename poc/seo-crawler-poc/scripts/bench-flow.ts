/**
 * Orchestrates serve -> bench -> evidence-check -> poc-report. Every step also runs standalone
 * via its own `tsx scripts/<name>.ts` invocation — this just chains them for convenience.
 * Usage: tsx scripts/bench-flow.ts [--skip-serve] [--keep-server] [--only name[,name]] [--skip-external] [--port 3105]
 */
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { PROJECT_ROOT } from "./lib/paths";

const { values } = parseArgs({
  options: {
    "skip-serve": { type: "boolean", default: false },
    "keep-server": { type: "boolean", default: false },
    only: { type: "string" },
    "skip-external": { type: "boolean", default: false },
    port: { type: "string" },
  },
});

function run(script: string, args: string[]): number {
  console.log(`\n=== ${script} ${args.join(" ")} ===`);
  const res = spawnSync("npx", ["tsx", `scripts/${script}`, ...args], {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    shell: true,
  });
  return res.status ?? 1;
}

async function main(): Promise<void> {
  const portArgs = values.port ? ["--port", values.port] : [];

  if (!values["skip-serve"]) {
    const code = run("serve-target-site.ts", portArgs);
    if (code !== 0) throw new Error(`serve-target-site.ts failed (exit ${code})`);
  }

  try {
    const benchArgs = [
      ...(values.only ? ["--only", values.only] : []),
      ...(values["skip-external"] ? ["--skip-external"] : []),
      ...portArgs,
    ];
    const benchCode = run("bench.ts", benchArgs);
    if (benchCode !== 0) console.warn(`bench.ts exited ${benchCode} — continuing to evidence-check/poc-report anyway`);

    const evidenceCode = run("evidence-check.ts", []);
    if (evidenceCode !== 0) console.warn(`evidence-check.ts reported FAILs (exit ${evidenceCode}) — see evidence.md`);

    const reportCode = run("poc-report.ts", []);
    if (reportCode !== 0) throw new Error(`poc-report.ts failed (exit ${reportCode})`);
  } finally {
    if (!values["skip-serve"] && !values["keep-server"]) {
      run("stop-target-site.ts", []);
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
