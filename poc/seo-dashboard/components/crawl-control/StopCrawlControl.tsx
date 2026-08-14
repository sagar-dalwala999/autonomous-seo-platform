"use client";

import { useState } from "react";
import { Ban, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { requestCancelCrawl, type CancelledCrawlStatus } from "@/lib/crawl-control-client";

type LocalState = "idle" | "confirming" | "stopping" | "error";

interface Props {
  runId: string;
  size?: "sm" | "md";
  label?: string;
  onCancelled: (crawl: CancelledCrawlStatus) => void;
  className?: string;
}

/**
 * Shared Stop control for the new-crawl progress panel and every Queue-screen row. Inline confirm
 * (never window.confirm — it blocks Playwright automation), a distinct disabled "Stopping…" state,
 * and only calls onCancelled once the backend response confirms the process was actually killed —
 * never optimistically on click. 409 (already finished) and 404 (unknown run) render as a plain
 * message next to the button, not a thrown error.
 */
export function StopCrawlControl({ runId, size = "md", label = "Stop crawl", onCancelled, className }: Props) {
  const [state, setState] = useState<LocalState>("idle");
  const [error, setError] = useState<string | null>(null);

  async function confirmStop() {
    setState("stopping");
    setError(null);
    const outcome = await requestCancelCrawl(runId);
    if (outcome.ok) {
      onCancelled(outcome.crawl);
      return;
    }
    setError(outcome.message);
    setState("error");
  }

  if (state === "confirming") {
    return (
      <div
        role="group"
        aria-label="Confirm stop crawl"
        className={cn("flex flex-wrap items-center gap-2 rounded-control border border-danger/30 bg-danger-bg px-3 py-2", className)}
      >
        <span className="text-xs text-danger">Stop this crawl? Pages already crawled are kept, but the run will not finish.</span>
        <div className="ml-auto flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setState("idle")}>
            Keep running
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="border-danger text-danger hover:bg-danger-bg"
            onClick={() => void confirmStop()}
          >
            Yes, stop it
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Button type="button" size={size} variant="outline" disabled={state === "stopping"} onClick={() => setState("confirming")}>
        {state === "stopping" ? (
          <Loader2 size={13} strokeWidth={2} className="animate-spin" aria-hidden="true" />
        ) : (
          <Ban size={13} strokeWidth={2} aria-hidden="true" />
        )}
        {state === "stopping" ? "Stopping…" : label}
      </Button>
      {state === "error" && error && (
        <p role="alert" className="flex items-start gap-1 text-[11px] text-danger">
          <AlertTriangle size={12} strokeWidth={1.75} className="mt-[1px] shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}
