import { CircleSlash2, ListFilter } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import type { MeasurementCardVM } from "@/lib/measurements-view";

interface Props {
  card: MeasurementCardVM;
  onViewPages?: (id: string, label: string) => void;
}

/** `available:false` renders visibly different from a real zero — dashed border, muted icon,
 *  the stated reason instead of a number. A grid where "0 broken links" secretly means "never
 *  checked" is the exact dishonesty this build has been correcting all day. */
export function MeasurementCard({ card, onViewPages }: Props) {
  const partial = card.available && card.sampleSize !== null && card.totalPages !== null && card.sampleSize < card.totalPages;

  return (
    <Card
      hoverLift={card.available}
      className={cn("flex h-full flex-col gap-2", !card.available && "border-dashed border-border-strong bg-subtle shadow-none")}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-faint">{card.label}</p>
        {!card.available && <CircleSlash2 size={14} strokeWidth={1.75} className="shrink-0 text-faint" aria-hidden="true" />}
      </div>

      {card.available ? (
        <div className="text-2xl font-semibold leading-tight tabular-nums text-foreground">{card.display ?? card.value ?? "—"}</div>
      ) : (
        <div className="text-sm font-medium text-faint">Not available</div>
      )}

      <p className="flex-1 text-xs leading-relaxed text-secondary">{card.available ? card.explainer : card.unavailableReason ?? card.explainer}</p>

      {partial && (
        <p className="text-[11px] text-faint">
          Based on {card.sampleSize!.toLocaleString()} of {card.totalPages!.toLocaleString()} pages — not full-run coverage.
        </p>
      )}

      {card.available && onViewPages && (
        <button
          type="button"
          onClick={() => onViewPages(card.id, card.label)}
          className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-control border border-border bg-subtle px-2 py-1 text-xs font-medium text-secondary outline-none transition-colors duration-150 hover:bg-elevated hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ListFilter size={12} strokeWidth={2} aria-hidden="true" />
          View matching pages
        </button>
      )}
    </Card>
  );
}
