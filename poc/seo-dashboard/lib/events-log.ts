/**
 * Server-only. New lib file. Backs GET /api/crawls/:id/events (PLAN-03 §6b Activity stream).
 *
 * PRIMARY (real, when present): storage/runs/<id>/events.ndjson — one JSON object per line,
 * `{seq, type, ts, ...payload}`, seq monotonic starting at 1. This is the durable append-only
 * log §6b.1 designs against. As of this pass NO run on disk has this file — the crawler's event
 * writer is a sibling deliverable in flight. The reader below is built against the documented
 * shape so it activates the moment that file starts appearing, with zero route changes.
 *
 * FALLBACK (real, degraded): while no events.ndjson exists, synthesizes a minimal but genuinely
 * live stream from data that DOES exist today — crawl.log tail (lib/crawl-runner's tailLog) plus
 * a periodic `progress` event computed by counting pages/*.json on disk. This is explicitly
 * labeled `synthetic: true` per event so a client can never mistake it for the real taxonomy.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { getCrawlStatus, tailLog } from "./crawl-runner";

const STORAGE_ROOT = process.env.CRAWLER_STORAGE_DIR
  ? path.resolve(process.cwd(), process.env.CRAWLER_STORAGE_DIR)
  : path.resolve(process.cwd(), "..", "seo-crawler-poc", "storage");
const RUNS_DIR = path.join(STORAGE_ROOT, "runs");

export interface CrawlEvent {
  seq: number;
  /** SSE `event:` field. Durable rows carry the real taxonomy in `kind` (src/events/types.ts:
   *  crawl-started | request | browser-render | certificate-check | outbound-link-check |
   *  image-measuring | crawl-cancelled | crawl-finished) — normalized to `type` here so this
   *  route's one SSE-framing code path (route.ts's `send`) works for both durable and synthetic
   *  events without a kind/type branch at every call site. */
  type: string;
  ts: string;
  synthetic: boolean;
  [key: string]: unknown;
}

/** The on-disk shape src/events/eventLog.ts (sibling, do-not-touch — read-only reference) writes
 *  to events.ndjson: `{seq, runId, kind, at, url, statusCode, message, detail?}`. Confirmed live
 *  against storage/runs/extraction-verify/events.ndjson — an earlier version of this reader
 *  assumed `{type, ts}` field names that do not exist in the real file and would have silently
 *  produced `event: undefined` SSE frames the moment the durable log appeared for any run. */
interface RawDurableEvent {
  seq: number;
  runId: string;
  kind: string;
  at: string;
  url: string | null;
  statusCode: number | null;
  message: string;
  detail?: Record<string, unknown>;
}

function eventsPath(runId: string): string {
  return path.join(RUNS_DIR, runId, "events.ndjson");
}

export async function hasDurableEventLog(runId: string): Promise<boolean> {
  try {
    await readFile(eventsPath(runId), "utf8");
    return true;
  } catch {
    return false;
  }
}

/** Parses events.ndjson from a given 1-indexed seq (exclusive) onward. Malformed lines are
 *  skipped, not fatal — a partially-flushed last line during a live write is expected. */
export async function readDurableEvents(runId: string, fromSeqExclusive: number): Promise<CrawlEvent[]> {
  let text: string;
  try {
    text = await readFile(eventsPath(runId), "utf8");
  } catch {
    return [];
  }
  const out: CrawlEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const raw = JSON.parse(line) as RawDurableEvent;
      if (typeof raw.seq !== "number" || raw.seq <= fromSeqExclusive) continue;
      out.push({
        seq: raw.seq,
        type: raw.kind,
        ts: raw.at,
        synthetic: false,
        runId: raw.runId,
        url: raw.url,
        statusCode: raw.statusCode,
        message: raw.message,
        detail: raw.detail,
      });
    } catch {
      // partial/malformed line — skip
    }
  }
  return out;
}

async function countPageFiles(runId: string): Promise<number> {
  try {
    const files = await readdir(path.join(RUNS_DIR, runId, "pages"));
    return files.filter((f) => f.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

/**
 * Synthesizes events from crawl.log's tail + a live page-file count. No persistent per-client
 * cursor exists in this fallback (there is no durable store to read a real cursor from), so each
 * call emits at most one new `log` event (the newest tail line, only if it changed) plus one
 * `progress` event every call. Deliberately does NOT emit a terminal `done` itself — an earlier
 * version did, and because this function is called both once at stream-open (replay) and again on
 * the first tail tick, a run that was already finished at connect time got `done` twice in the
 * same ~1s window. The caller (the SSE route) owns emitting `done` exactly once, guarded by its
 * own one-shot flag — see app/api/crawls/[runId]/events/route.ts.
 */
export async function readSyntheticEvents(runId: string, fromSeqExclusive: number, lastLogLine: string | null): Promise<{ events: CrawlEvent[]; lastLogLine: string | null }> {
  const [status, logLines, pageCount] = await Promise.all([getCrawlStatus(runId), tailLog(runId, 1), countPageFiles(runId)]);
  const events: CrawlEvent[] = [];
  let seq = fromSeqExclusive;
  const newestLine = logLines[0] ?? null;

  if (newestLine && newestLine !== lastLogLine) {
    seq++;
    events.push({ seq, type: "log", ts: new Date().toISOString(), synthetic: true, line: newestLine });
  }

  seq++;
  events.push({ seq, type: "progress", ts: new Date().toISOString(), synthetic: true, crawled: pageCount, state: status?.state ?? "unknown" });

  return { events, lastLogLine: newestLine };
}
