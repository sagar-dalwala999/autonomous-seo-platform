"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Calendar, ChevronDown } from "lucide-react";
import type { RunListItem } from "@/lib/data";
import { pickDefaultRun } from "@/lib/run-selection";
import { cn } from "@/lib/cn";
import { hostnameFor, formatRunTimestamp } from "./run-label";

/** Global (shell-level) custom dropdown (not a native <select>) — chip trigger + a focus-trapped
 * listbox. Rendered by Topbar on every data route so a selected run survives navigation. */
export function RunSelector({ runs }: { runs: RunListItem[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Same rule as lib/data.ts resolveRunId(): valid ?run= wins, otherwise pickDefaultRun decides.
  const requested = searchParams.get("run");
  const current = (requested && runs.find((r) => r.runId === requested)) || pickDefaultRun(runs);

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
    router.push(`${pathname}?${params.toString()}`);
  }

  if (!current) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={current.runId}
        className="inline-flex items-center gap-1.5 rounded-pill border border-border-strong bg-elevated px-3 py-1.5 text-xs font-medium text-foreground shadow-card transition-colors duration-150 hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Calendar size={12} strokeWidth={1.75} aria-hidden="true" />
        {hostnameFor(current.startUrl)} · {formatRunTimestamp(current.startedAt)}
        <ChevronDown size={12} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Select crawl run"
          // Right-anchored: the trigger sits at the viewport's right edge, so a left-anchored
          // panel overflowed and clipped the coverage/page counts.
          className="absolute right-0 top-[calc(100%+4px)] z-20 max-h-72 w-80 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-control border border-border bg-elevated py-1 shadow-popover"
        >
          {runs.map((run) => (
            <li key={run.runId}>
              <button
                type="button"
                role="option"
                aria-selected={run.runId === current.runId}
                onClick={() => choose(run.runId)}
                title={run.runId}
                className={cn(
                  "flex w-full min-w-0 flex-col items-start gap-0.5 px-3 py-2 text-left text-xs transition-colors duration-150 hover:bg-subtle",
                  run.runId === current.runId && "bg-subtle",
                )}
              >
                <span className="w-full truncate font-medium text-foreground">{hostnameFor(run.startUrl)}</span>
                <span className="w-full truncate text-faint">
                  {formatRunTimestamp(run.startedAt)} · {run.coveragePercent}% coverage · {run.successful} pages
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
