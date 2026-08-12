import Link from "next/link";
import type { CrawlSummary } from "@/lib/types";
import { cn } from "@/lib/cn";

function bucketCount(histogram: Record<string, number>, min: number, max: number): number {
  return Object.entries(histogram).reduce((sum, [code, count]) => {
    const n = Number(code);
    return n >= min && n <= max ? sum + count : sum;
  }, 0);
}

export function FilterChips({ report, runId }: { report: CrawlSummary; runId: string }) {
  const successful = bucketCount(report.statusHistogram, 200, 299);
  const redirects = bucketCount(report.statusHistogram, 300, 399);
  const failed = bucketCount(report.statusHistogram, 400, 599);
  const q = `run=${encodeURIComponent(runId)}`;

  const chips: { label: string; count: number; href: string; danger?: boolean }[] = [
    { label: "All pages", count: report.attempted, href: `/pages?${q}` },
    { label: "Successful", count: successful, href: `/pages?${q}&status=2xx` },
    { label: "Redirects", count: redirects, href: `/pages?${q}&status=3xx` },
    { label: "Failed", count: failed, href: `/pages?${q}&status=4xx`, danger: failed > 0 },
    { label: "Blocked", count: report.blockedByRobots, href: `/failures?${q}`, danger: report.blockedByRobots > 0 },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <Link
          key={chip.label}
          href={chip.href}
          className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-subtle px-2.5 py-1 text-xs font-medium text-secondary transition-colors duration-150 hover:bg-elevated hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {chip.danger && <span className="h-1.5 w-1.5 rounded-full bg-danger" aria-hidden="true" />}
          {chip.label}
          <span className={cn("rounded-pill px-1.5 tabular-nums", chip.danger ? "bg-danger-bg text-danger" : "bg-elevated text-faint")}>{chip.count}</span>
        </Link>
      ))}
    </div>
  );
}
