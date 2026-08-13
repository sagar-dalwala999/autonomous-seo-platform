"use client";

import { useEffect, useRef, useState } from "react";
import { Radar } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusChip } from "./StatusChip";
import { StopCrawlControl } from "@/components/crawl-control/StopCrawlControl";
import type { CancelledCrawlStatus } from "@/lib/crawl-control-client";
import type { CrawlStatusResponse, PanelState } from "./types";

interface Props {
  panelState: PanelState;
  url: string;
  runId: string | null;
  status: CrawlStatusResponse | null;
  onViewRun: () => void;
  onRetry: () => void;
  onCancelled: (crawl: CancelledCrawlStatus) => void;
}

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Owns the elapsed-time tick in isolation, remounted via `key={runId}` from the parent so a new
 * crawl starts its clock at 0 for free (React's documented reset-via-key pattern) instead of a
 * setState call inside an effect body reacting to a prop change (react-hooks/set-state-in-effect)
 * or a ref mutated during render (react-hooks/refs) — both rejected by this project's lint config.
 */
function ElapsedClock({ active }: { active: boolean }) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;
    if (startRef.current === null) startRef.current = Date.now();
    const id = setInterval(() => setElapsedMs(Date.now() - (startRef.current ?? Date.now())), 1000);
    return () => clearInterval(id);
  }, [active]);

  return <span className="text-xs tabular-nums text-faint">{formatElapsed(elapsedMs)}</span>;
}

export function ProgressPanel({ panelState, url, runId, status, onViewRun, onRetry, onCancelled }: Props) {
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [status?.log]);

  if (panelState === "form") {
    return <EmptyState icon={Radar} title="No crawl running" description="Fill out the form and submit to see live progress here." />;
  }

  if (panelState === "starting") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center">
        <StatusChip state="starting" />
        <p className="text-sm text-secondary">Spawning crawler…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <StatusChip state={panelState} />
        <ElapsedClock key={runId ?? "unknown"} active={panelState === "running"} />
      </div>

      <p className="truncate text-sm font-medium text-foreground">
        {panelState === "running" && `Crawling ${url}`}
        {panelState === "done" && "Crawl complete"}
        {panelState === "failed" && "Crawl failed"}
        {panelState === "cancelled" && "Crawl cancelled"}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {runId && <p className="text-xs text-faint">run: {runId}</p>}
        {panelState === "done" && status && (
          <Badge tone={status.reportReady ? "ok" : "neutral"}>{status.reportReady ? "Report ready" : "Report pending"}</Badge>
        )}
      </div>
      {panelState === "failed" && status && <p className="text-xs text-danger">exit code {status.exitCode ?? "unknown"}</p>}
      {panelState === "cancelled" && status?.note && <p className="text-xs text-secondary">{status.note}</p>}

      {panelState === "running" && runId && <StopCrawlControl runId={runId} onCancelled={onCancelled} className="self-start" />}

      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">Log tail</p>
        <pre
          ref={logRef}
          className="max-h-96 overflow-y-auto rounded-control border border-border bg-canvas p-3 font-mono text-[11px] leading-relaxed text-secondary whitespace-pre-wrap break-all"
        >
          {status?.log && status.log.length > 0 ? status.log.join("\n") : "waiting for output…"}
        </pre>
      </div>

      {panelState === "done" && (
        <Button variant="dark" onClick={onViewRun}>
          View run
        </Button>
      )}
      {panelState === "failed" && (
        <Button variant="outline" onClick={onRetry}>
          Retry
        </Button>
      )}
      {panelState === "cancelled" && (
        <Button variant="outline" onClick={onRetry}>
          Start another crawl
        </Button>
      )}
    </div>
  );
}
