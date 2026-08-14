import { NextRequest } from "next/server";
import { isSafeId } from "@/lib/api-shared";
import { getCrawlStatus } from "@/lib/crawl-runner";
import { hasDurableEventLog, readDurableEvents, readSyntheticEvents } from "@/lib/events-log";
import { getRun } from "@/lib/data";
import { requireApiSession } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";

/**
 * GET /crawls/:id/events — SSE Activity log, live tail + historic replay (PLAN-03 §6b).
 * `Last-Event-ID` header (sent automatically by EventSource on reconnect) or `?fromSeq=` resumes
 * from that point. `?live=false` drains what's available then closes instead of tailing forever.
 * Prefers the durable events.ndjson a sibling agent is writing; falls back to a synthesized
 * progress/log stream (each event flagged `synthetic: true`) when that file does not exist yet
 * for this run — see lib/events-log.ts's header comment for the full contract.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const { runId } = await params;
  if (!isSafeId(runId)) return new Response("Invalid runId", { status: 400 });

  const sp = request.nextUrl.searchParams;
  const live = sp.get("live") !== "false";
  const lastEventIdHeader = request.headers.get("last-event-id");
  const fromSeqParam = sp.get("fromSeq");
  let cursor = 0;
  if (lastEventIdHeader && /^\d+$/.test(lastEventIdHeader)) cursor = Number(lastEventIdHeader);
  else if (fromSeqParam && /^\d+$/.test(fromSeqParam)) cursor = Number(fromSeqParam);

  // format=json&live=false — paginated historic replay as plain JSON instead of SSE (spec §7).
  if (!live && sp.get("format") === "json") {
    const durable = await hasDurableEventLog(runId);
    const events = durable ? await readDurableEvents(runId, cursor) : (await readSyntheticEvents(runId, cursor, null)).events;
    return Response.json({ data: events, source: durable ? "durable" : "synthetic" });
  }

  const encoder = new TextEncoder();
  let closed = false;
  let lastLogLine: string | null = null;
  // Owns the terminal `done` event for the synthetic (non-durable) path: readSyntheticEvents
  // never emits one itself (see its doc comment) precisely so this single flag is the only place
  // "done" can be sent, however many times the drain step + tail ticks run.
  let doneSent = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (evt: { seq: number; type: string; [k: string]: unknown }) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`id: ${evt.seq}\nevent: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`));
      };

      // Pulls one batch of events (durable or synthetic) and, for the synthetic path only, emits
      // the terminal `done` exactly once when the tracked crawl is no longer running. Durable-log
      // mode does not need this — a real terminal row (`crawl-finished` | `crawl-cancelled`, the
      // taxonomy in src/events/types.ts) is what a sibling agent writes.
      const TERMINAL_KINDS = new Set(["crawl-finished", "crawl-cancelled"]);
      const pullOnce = async (): Promise<boolean> => {
        const durable = await hasDurableEventLog(runId);
        if (durable) {
          for (const evt of await readDurableEvents(runId, cursor)) {
            send(evt);
            cursor = evt.seq;
            if (TERMINAL_KINDS.has(evt.type)) doneSent = true;
          }
          return doneSent;
        }
        const { events, lastLogLine: nextLine } = await readSyntheticEvents(runId, cursor, lastLogLine);
        for (const evt of events) {
          send(evt);
          cursor = evt.seq;
        }
        lastLogLine = nextLine;

        if (!doneSent) {
          const status = await getCrawlStatus(runId);
          const { report } = await getRun(runId);
          if (status && status.state !== "running" && report) {
            cursor++;
            send({ seq: cursor, type: "done", ts: new Date().toISOString(), synthetic: true, status: status.state, exitCode: status.exitCode });
            doneSent = true;
          }
        }
        return doneSent;
      };

      // 1) Drain everything from the requested cursor (replay), respecting client backpressure
      //    is out of scope for a single-tenant POC dev server — see §6b.2's real design for that.
      const finishedAlready = await pullOnce();

      if (!live || finishedAlready) {
        controller.close();
        closed = true;
        return;
      }

      // 2) Tail: poll every 1s. A real deployment replaces this with LISTEN/NOTIFY (§6b.2); a
      //    1s poll against local disk is the honest POC equivalent, not a production pattern.
      // `tickInFlight` guards against setInterval firing a new tick before the previous async
      // callback settles (fs contention, dev-server load) — without it two overlapping ticks can
      // both read the same cursor and duplicate work before either observes `doneSent`.
      let tickInFlight = false;
      const interval = setInterval(async () => {
        if (closed || tickInFlight) return;
        tickInFlight = true;
        try {
          const finished = await pullOnce();
          if (finished && !closed) {
            clearInterval(interval);
            closed = true;
            controller.close();
          }
        } catch (err) {
          console.error(`[api/crawls/${runId}/events] tail error`, err);
        } finally {
          tickInFlight = false;
        }
      }, 1000);

      request.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(interval);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
