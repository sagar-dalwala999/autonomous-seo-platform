"use client";

import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { MeasurementCard } from "./measurement-card";
import { MatchingPagesPanel } from "./matching-pages-panel";
import { categorySort, type MeasurementsViewModel } from "@/lib/measurements-view";

interface Props {
  runId: string;
  data: MeasurementsViewModel;
  drilldownSupportedIds: string[];
}

export function MeasurementsGrid({ runId, data, drilldownSupportedIds }: Props) {
  const [panel, setPanel] = useState<{ id: string; label: string } | null>(null);
  // Drill-down is gated to the v2 shape ONLY. A couple of legacy ids (e.g. "thin-content") reuse
  // v2's id but computed a DIFFERENT number under a different rule (legacy's thin-content is a
  // hardcoded <300-word count; the drill-down matcher applies the real config threshold) — showing
  // the button there would link to a filtered set that silently disagrees with the card's own
  // figure, the exact "chip counted 400-599 but linked to status=4xx" bug class this build is
  // fighting. Real per-measurement drill-downs only turn on once the endpoint returns v2 data,
  // where the ids' semantics are guaranteed to match compute.ts's own numbers.
  const supported = useMemo(() => (data.shape === "v2" ? new Set(drilldownSupportedIds) : new Set<string>()), [drilldownSupportedIds, data.shape]);

  const grouped = useMemo(() => {
    const byCategory = new Map<string, typeof data.cards>();
    for (const card of data.cards) {
      const list = byCategory.get(card.category) ?? [];
      list.push(card);
      byCategory.set(card.category, list);
    }
    return [...byCategory.entries()].sort((a, b) => categorySort(a[0], b[0]));
  }, [data]);

  return (
    <div className="space-y-6">
      {data.shape === "legacy" && (
        <div className="flex items-start gap-2 rounded-card border border-dashed border-border-strong bg-subtle p-3 text-xs text-secondary">
          <AlertTriangle size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-faint" aria-hidden="true" />
          <p>
            Showing the current measurements endpoint&apos;s response ({data.cards.length} figures, every number real). The richer 31-card grid with
            plain-language explainers and per-measurement drill-downs activates automatically once <code className="rounded border border-border bg-elevated px-1">/api/crawls/:id/measurements</code> is
            wired to the new computation layer — no change needed on this page when that happens.
          </p>
        </div>
      )}

      {grouped.map(([category, cards]) => (
        <section key={category}>
          <h2 className="mb-2 text-sm font-semibold text-foreground">{category}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {cards.map((card) => (
              <MeasurementCard
                key={card.id}
                card={card}
                onViewPages={supported.has(card.id) ? (id, label) => setPanel({ id, label }) : undefined}
              />
            ))}
          </div>
        </section>
      ))}

      <MatchingPagesPanel runId={runId} open={panel !== null} measurementId={panel?.id ?? null} measurementLabel={panel?.label ?? null} onClose={() => setPanel(null)} />
    </div>
  );
}
