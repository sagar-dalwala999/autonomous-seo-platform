"use client";

import { useMemo, useState } from "react";
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

  const supported = useMemo(
    () => (data.shape === "v2" ? new Set(drilldownSupportedIds) : new Set<string>()),
    [drilldownSupportedIds, data.shape],
  );

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
      {grouped.map(([category, cards]) => (
        <section key={category} className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-secondary">{category}</h3>
            <span className="text-xs text-faint">{cards.length} metrics</span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
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

      <MatchingPagesPanel
        runId={runId}
        open={panel !== null}
        measurementId={panel?.id ?? null}
        measurementLabel={panel?.label ?? null}
        onClose={() => setPanel(null)}
      />
    </div>
  );
}
