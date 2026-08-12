/** Shared filesystem locations for the bench harness. All paths are absolute. */
import { fileURLToPath } from "node:url";
import path from "node:path";

const SCRIPTS_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export const PROJECT_ROOT = path.dirname(SCRIPTS_DIR);
export const TARGET_SITE_DIR = path.resolve(PROJECT_ROOT, "..", "target-site");
export const STORAGE_DIR = path.join(PROJECT_ROOT, "storage");
export const RUNS_DIR = path.join(STORAGE_DIR, "runs");
export const BENCH_DIR = path.join(STORAGE_DIR, "bench");
export const TARGET_SITE_STATE_FILE = path.join(SCRIPTS_DIR, ".target-site.json");
export const TARGET_SITE_PORT_FILE = path.join(SCRIPTS_DIR, ".target-site-port");
export const POC_REPORT_FILE = path.join(PROJECT_ROOT, "POC-1-REPORT.md");
