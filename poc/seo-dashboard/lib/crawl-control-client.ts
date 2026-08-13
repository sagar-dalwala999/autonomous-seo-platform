"use client";

/** Client-side wrapper for POST /api/crawls/:id/cancel — the ONLY caller of that endpoint, so
 *  every Stop control in the app shares identical honest success/409/404/network handling. */

export interface CancelledCrawlStatus {
  runId: string;
  state: string;
  note?: string;
  endedAt?: string | null;
  exitCode?: number | null;
  [key: string]: unknown;
}

export type CancelOutcome =
  | { ok: true; crawl: CancelledCrawlStatus }
  | { ok: false; code: "NOT_RUNNING" | "NOT_FOUND" | "SERVER" | "NETWORK"; message: string };

export async function requestCancelCrawl(runId: string): Promise<CancelOutcome> {
  let res: Response;
  try {
    res = await fetch(`/api/crawls/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
  } catch {
    return { ok: false, code: "NETWORK", message: "Network error while stopping the crawl. Check the dashboard server is running." };
  }

  let body: { crawl?: CancelledCrawlStatus; error?: { code?: string; message?: string } } | null = null;
  try {
    body = await res.json();
  } catch {
    // no/invalid JSON body — fall through to the status-based message below
  }

  if (res.status === 202 && body?.crawl) return { ok: true, crawl: body.crawl };
  if (res.status === 409) {
    return { ok: false, code: "NOT_RUNNING", message: body?.error?.message ?? "This crawl is no longer running — it may have already finished." };
  }
  if (res.status === 404) {
    return { ok: false, code: "NOT_FOUND", message: body?.error?.message ?? "This run could not be found." };
  }
  return { ok: false, code: "SERVER", message: body?.error?.message ?? `Failed to stop the crawl (HTTP ${res.status}).` };
}
