"use client";

import { SlideOver } from "@/components/ui/slide-over";
import { Button } from "@/components/ui/button";
import type { FixPlanItem } from "@/lib/data-issue-extras";

interface Props {
  open: boolean;
  onClose: () => void;
  ruleId: string | null;
  items: FixPlanItem[];
  available: boolean;
  runId: string;
}

/** available=false means fix-plan.json hasn't been generated for this run (npm run fixplan wasn't
 *  run) — distinct from "generated, but zero items for this rule" (items.length === 0). Never
 *  fabricates a fix — every item shown here comes straight from the sibling's fixplan output. */
export function FixPlanPanel({ open, onClose, ruleId, items, available, runId }: Props) {
  function downloadJson() {
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fix-plan-${runId}-${ruleId ?? "all"}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <SlideOver open={open} onClose={onClose} title={ruleId ? `Fix plan · ${ruleId}` : "Fix plan"} widthClassName="w-[420px]">
      {!available ? (
        <p className="text-sm text-faint">
          Fix plan not generated for this run yet — run{" "}
          <code className="rounded border border-border bg-elevated px-1 py-0.5 text-[11px]">npm run fixplan -- --run {runId}</code> from{" "}
          <code className="rounded border border-border bg-elevated px-1 py-0.5 text-[11px]">seo-crawler-poc</code>.
        </p>
      ) : items.length === 0 ? (
        <p className="text-sm text-faint">No auto-safe fix for this rule — either it isn&apos;t classified auto-safe, or no concrete value could be computed for the affected pages.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-faint">
            These changes are safe to apply automatically. This tool never applies them — <strong className="text-foreground">applied: false</strong>, always.
          </p>
          <Button size="sm" variant="outline" onClick={downloadJson}>
            Download JSON ({items.length})
          </Button>
          <ul className="space-y-2">
            {items.map((it, i) => (
              <li key={i} className="rounded-control border border-border bg-subtle p-3 text-xs">
                <p className="font-medium text-foreground">{it.action}</p>
                <p className="mt-1 text-secondary">{it.where}</p>
                <p className="mt-1 text-faint">{Array.isArray(it.change) ? it.change.join(" · ") : it.change}</p>
                {it.url && <p className="mt-1 truncate text-faint">{it.url}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </SlideOver>
  );
}
