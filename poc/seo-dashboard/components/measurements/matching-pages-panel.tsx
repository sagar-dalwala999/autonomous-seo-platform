"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, FileWarning } from "lucide-react";
import { SlideOver } from "@/components/ui/slide-over";
import { Badge } from "@/components/ui/badge";
import { fetchMatchingPages } from "@/app/measurements/actions";
import type { DrilldownResult } from "@/lib/measurements-drilldown";

function statusTone(status: number | null): "ok" | "danger" | "warn" | "neutral" {
  if (status === null) return "neutral";
  if (status < 300) return "ok";
  if (status < 400) return "warn";
  return "danger";
}

interface Props {
  runId: string;
  open: boolean;
  measurementId: string | null;
  measurementLabel: string | null;
  onClose: () => void;
}

/** On-demand (Server Action, not a bulk prop) — a 1000+ page run never pays for 12 unopened
 *  drill-downs' worth of payload, only the one actually clicked. */
export function MatchingPagesPanel({ runId, open, measurementId, measurementLabel, onClose }: Props) {
  return (
    <SlideOver open={open} onClose={onClose} title={measurementLabel ?? "Matching pages"}>
      {/* Keyed by measurementId so switching cards while the panel stays open remounts a fresh
          loading state instead of a synchronous setState-in-effect reset (react-hooks/set-state-
          in-effect) — the reset comes from React discarding the old instance, not an extra render. */}
      {open && measurementId && <MatchingPagesBody key={measurementId} runId={runId} measurementId={measurementId} />}
    </SlideOver>
  );
}

function MatchingPagesBody({ runId, measurementId }: { runId: string; measurementId: string }) {
  const [state, setState] = useState<{ loading: boolean; result: DrilldownResult | null; error: boolean }>({ loading: true, result: null, error: false });

  useEffect(() => {
    let cancelled = false;
    fetchMatchingPages(runId, measurementId)
      .then((result) => {
        if (!cancelled) setState({ loading: false, result, error: false });
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, result: null, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [runId, measurementId]);

  if (state.loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-secondary">
        <Loader2 size={16} className="animate-spin" aria-hidden="true" />
        Loading matching pages…
      </div>
    );
  }
  if (state.error || !state.result) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-danger">
        <FileWarning size={16} aria-hidden="true" />
        Couldn&apos;t load matching pages.
      </div>
    );
  }

  const { result } = state;
  return (
    <div className="space-y-3">
      <p className="text-xs text-secondary">
        {result.total.toLocaleString()} matching page{result.total === 1 ? "" : "s"}
        {result.truncated && ` (showing first ${result.rows.length.toLocaleString()})`}
      </p>
      {result.rows.length === 0 ? (
        <p className="text-sm text-faint">None.</p>
      ) : (
        <ul className="space-y-1.5">
          {result.rows.map((row) => (
            <li key={row.pageId} className="flex items-center justify-between gap-2 border-b border-border pb-1.5 last:border-0">
              <Link href={`/pages/${row.pageId}?run=${encodeURIComponent(runId)}`} className="min-w-0 flex-1 truncate text-xs text-primary underline underline-offset-2">
                {row.url}
              </Link>
              <Badge tone={statusTone(row.statusCode)} className="shrink-0">
                {row.statusCode ?? "—"}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
