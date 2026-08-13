import type { HealthHistoryPoint } from "@/lib/data-issue-extras";
import { DeltaPill } from "@/components/ui/delta-pill";

/** Hand-rolled inline SVG sparkline — this app has no charting library (matches
 *  components/charts/*'s own hand-SVG convention), never a fabricated trend when there isn't one. */
export function HealthTrend({ history }: { history: HealthHistoryPoint[] }) {
  const scored = history.filter((h): h is HealthHistoryPoint & { healthScore: number } => h.healthScore !== null);
  if (scored.length < 2) {
    return <p className="text-xs text-faint">Not enough judged crawls of this site yet for a trend line.</p>;
  }

  const w = 220;
  const h = 40;
  const pad = 3;
  const stepX = (w - pad * 2) / (scored.length - 1);
  const points = scored.map((p, i) => ({
    x: pad + i * stepX,
    y: pad + (1 - p.healthScore / 100) * (h - pad * 2),
  }));
  const path = points.map((pt, i) => `${i === 0 ? "M" : "L"}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(" ");
  const area = `${path} L${points[points.length - 1].x.toFixed(1)},${h - pad} L${points[0].x.toFixed(1)},${h - pad} Z`;

  const first = scored[0].healthScore;
  const last = scored[scored.length - 1].healthScore;
  const delta = last - first;
  const direction = delta > 0 ? "up" : delta < 0 ? "down" : "neutral";

  return (
    <div className="flex items-center gap-3">
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        className="text-primary"
        role="img"
        aria-label={`Health score trend across ${scored.length} crawls of this site, from ${first} to ${last}`}
      >
        <path d={area} fill="currentColor" opacity="0.12" />
        <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <div>
        <p className="text-xs text-faint">{scored.length} judged crawls of this site</p>
        <DeltaPill direction={direction} label={`${delta > 0 ? "+" : ""}${delta} vs first`} />
      </div>
    </div>
  );
}
