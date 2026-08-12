import Link from "next/link";
import { cn } from "@/lib/cn";
import type { IssueSeverity } from "@/lib/types";

interface Props {
  runId: string;
  severities: { key: IssueSeverity; count: number }[];
  categories: string[];
  activeSeverity: IssueSeverity | null;
  activeCategory: string | null;
}

const LABEL: Record<IssueSeverity, string> = { error: "Error", warning: "Warning", notice: "Notice" };

function chipHref(runId: string, severity: string | null, category: string | null): string {
  const params = new URLSearchParams({ run: runId });
  if (severity) params.set("severity", severity);
  if (category) params.set("category", category);
  return `/issues?${params.toString()}`;
}

function chipClass(active: boolean): string {
  return cn(
    "inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-xs font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-primary",
    active
      ? "border-primary bg-primary text-primary-contrast"
      : "border-border bg-subtle text-secondary hover:bg-elevated hover:text-foreground",
  );
}

/** Severity + category filters, both reflected in the URL (?severity=&category=) so the view is
 *  shareable and back/forward-safe — design-dna-v2 Law 1. */
export function IssuesFilterChips({ runId, severities, categories, activeSeverity, activeCategory }: Props) {
  const total = severities.reduce((sum, s) => sum + s.count, 0);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Link href={chipHref(runId, null, activeCategory)} className={chipClass(activeSeverity === null)}>
          All severities <span className="tabular-nums">{total}</span>
        </Link>
        {severities.map((s) => (
          <Link key={s.key} href={chipHref(runId, s.key, activeCategory)} className={chipClass(activeSeverity === s.key)}>
            {s.key === "error" && s.count > 0 && <span className="h-1.5 w-1.5 rounded-full bg-danger" aria-hidden="true" />}
            {LABEL[s.key]} <span className="tabular-nums">{s.count}</span>
          </Link>
        ))}
      </div>
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Link href={chipHref(runId, activeSeverity, null)} className={chipClass(activeCategory === null)}>
            All categories
          </Link>
          {categories.map((c) => (
            <Link key={c} href={chipHref(runId, activeSeverity, c)} className={chipClass(activeCategory === c)}>
              {c}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
