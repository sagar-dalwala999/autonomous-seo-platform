/** Server-only. New lib file for the /queue screen. This POC has no job/queue table — one crawl
 *  runs at a time, tracked per-run via .crawl-status.json (lib/crawl-runner.ts, do-not-touch). This
 *  reads every run directory's status file directly (same optional-safe pattern as data-issues.ts)
 *  to build a real job list: running / done / failed(/cancelled, derived from the status note) —
 *  never a fabricated "queued" row, since queuedCount is genuinely always 0 by construction here
 *  (see app/api/queue/route.ts, do-not-touch, which documents the same fact). */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { runsDirPath, readRunMeta } from "./crawl-control";

export type JobState = "running" | "done" | "failed" | "cancelled";

export interface QueueJob {
  runId: string;
  state: JobState;
  startUrl: string;
  maxPages: number;
  maxDepth: number | null;
  startedAt: string;
  endedAt: string | null;
  label: string | null;
  note?: string;
}

interface CrawlStatusFile {
  runId: string;
  state: "running" | "done" | "failed" | "cancelled";
  startUrl: string;
  maxPages: number;
  maxDepth: number | null;
  startedAt: string;
  endedAt: string | null;
  note?: string;
}

async function readStatusFile(runId: string): Promise<CrawlStatusFile | null> {
  try {
    const text = await readFile(path.join(runsDirPath(), runId, ".crawl-status.json"), "utf8");
    return JSON.parse(text) as CrawlStatusFile;
  } catch {
    return null;
  }
}

/** New status files write `cancelled` directly. The note-sniffing fallback only exists for runs
 *  cancelled before that fix shipped, whose .crawl-status.json still literally says `failed`. */
function deriveState(status: CrawlStatusFile): JobState {
  if (status.state === "failed" && status.note?.toLowerCase().includes("cancelled")) return "cancelled";
  return status.state;
}

/** Every run that has ever been started through this dashboard's "New crawl" flow (runs with a
 *  .crawl-status.json). Runs seeded onto disk some other way (fixtures, CLI-only crawls) have no
 *  status file and are correctly excluded — they never went through this app's queue. */
export async function listJobs(): Promise<QueueJob[]> {
  let runIds: string[];
  try {
    runIds = (await readdir(runsDirPath(), { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }

  const jobs: QueueJob[] = [];
  for (const runId of runIds) {
    const status = await readStatusFile(runId);
    if (!status) continue;
    const meta = await readRunMeta(runId);
    jobs.push({
      runId: status.runId ?? runId,
      state: deriveState(status),
      startUrl: status.startUrl,
      maxPages: status.maxPages,
      maxDepth: status.maxDepth,
      startedAt: status.startedAt,
      endedAt: status.endedAt,
      label: meta.label,
      note: status.note,
    });
  }
  return jobs.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}
