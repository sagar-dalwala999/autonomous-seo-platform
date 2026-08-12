"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Calendar, ChevronDown } from "lucide-react";
import type { RunListItem } from "@/lib/data";
import { cn } from "@/lib/cn";

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Custom dropdown (not a native <select>) — chip trigger + a focus-trapped listbox. */
export function RunSelector({ runs, currentRunId }: { runs: RunListItem[]; currentRunId: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  const current = runs.find((r) => r.runId === currentRunId) ?? runs[0];

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function choose(runId: string) {
    setOpen(false);
    const params = new URLSearchParams(searchParams.toString());
    params.set("run", runId);
    router.push(`/?${params.toString()}`);
  }

  if (!current) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-subtle px-2.5 py-1 text-xs font-medium text-secondary transition-colors duration-150 hover:bg-elevated hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Calendar size={12} strokeWidth={1.75} aria-hidden="true" />
        {current.runId} · {fmt(current.startedAt)}
        <ChevronDown size={12} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Select crawl run"
          className="absolute left-0 top-[calc(100%+4px)] z-20 max-h-72 w-80 overflow-y-auto rounded-control border border-border bg-elevated py-1 shadow-popover"
        >
          {runs.map((run) => (
            <li key={run.runId}>
              <button
                type="button"
                role="option"
                aria-selected={run.runId === currentRunId}
                onClick={() => choose(run.runId)}
                className={cn(
                  "flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-xs transition-colors duration-150 hover:bg-subtle",
                  run.runId === currentRunId && "bg-subtle",
                )}
              >
                <span className="font-medium text-foreground">{run.runId}</span>
                <span className="text-faint">
                  {fmt(run.startedAt)} · {run.coveragePercent}% coverage · {run.successful} pages
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
