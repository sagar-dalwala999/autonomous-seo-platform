import Link from "next/link";
import { Gauge, AlertOctagon, ShieldOff, HeartPulse, type LucideIcon } from "lucide-react";
import type { CrawlSummary } from "@/lib/types";
import { topFailureClasses } from "@/lib/data-overview";
import { readAnalysisReport } from "@/lib/data-issues";
import { Card } from "@/components/ui/card";
import { CoverageBar } from "@/components/overview/coverage-bar";
import { cn } from "@/lib/cn";

interface ActionCardProps {
  icon: LucideIcon;
  tint: "blue" | "amber" | "violet" | "green";
  label: string;
  value: string;
  unit?: string;
  footnote: string;
  ctaLabel: string;
  ctaHref: string;
  bar?: number;
  className?: string;
}

const TINT_CLASSES: Record<ActionCardProps["tint"], string> = {
  blue: "bg-data-blue/10 text-data-blue",
  amber: "bg-data-orange/10 text-data-orange",
  violet: "bg-data-violet/10 text-data-violet",
  green: "bg-data-green/10 text-data-green",
};

function ActionCard({ icon: Icon, tint, label, value, unit, footnote, ctaLabel, ctaHref, bar, className }: ActionCardProps) {
  return (
    <Card hoverLift className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center gap-2">
        <div className={cn("flex h-7 w-7 items-center justify-center rounded-control", TINT_CLASSES[tint])}>
          <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
        </div>
        <span className="text-xs font-medium text-secondary">{label}</span>
      </div>
      <div>
        <Link
          href={ctaHref}
          className="inline-flex items-baseline text-2xl font-semibold leading-tight tabular-nums text-foreground outline-none transition-opacity duration-150 hover:opacity-70 focus-visible:ring-2 focus-visible:ring-primary rounded-control"
        >
          {value}
          {unit && <span className="ml-1 text-base font-medium text-faint">{unit}</span>}
        </Link>
        <div className="mt-1 text-xs text-faint">{footnote}</div>
      </div>
      {bar !== undefined && <CoverageBar percent={bar} />}
      <Link
        href={ctaHref}
        className="mt-auto inline-flex items-center self-start rounded-control border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors duration-150 hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {ctaLabel}
      </Link>
    </Card>
  );
}

/** Async server component: fetches the analysis report itself (optional-safe) so the Health
 *  Score card wiring stays entirely inside this file — spec.md A5 owns this addition, not the
 *  Overview page that renders <ActionCards>. */
export async function ActionCards({ report, runId }: { report: CrawlSummary; runId: string }) {
  const q = `?run=${encodeURIComponent(runId)}`;
  const blockedFootnote =
    report.blockedByRobots > 0 ? `${report.blockedByRobots} URL${report.blockedByRobots === 1 ? "" : "s"} disallowed by robots.txt` : "robots.txt allowed every discovered URL";
  const analysis = await readAnalysisReport(runId);

  return (
    <div className={cn("grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4", analysis ? "lg:grid-cols-3 xl:grid-cols-5" : "lg:grid-cols-4")}>
      <ActionCard
        icon={Gauge}
        tint="blue"
        label="Crawl coverage"
        value={String(report.coveragePercent)}
        unit="%"
        footnote={`${report.successful} of ${report.attempted} attempted`}
        ctaLabel="View failures"
        ctaHref={`/failures${q}`}
        bar={report.coveragePercent}
        className="sm:col-span-2 lg:col-span-1 xl:col-span-2"
      />
      <ActionCard
        icon={AlertOctagon}
        tint="amber"
        label="Failed URLs"
        value={String(report.failed)}
        footnote={`Top: ${topFailureClasses(report.failuresByClass)}`}
        ctaLabel="Open failures"
        ctaHref={`/failures${q}`}
      />
      <ActionCard
        icon={ShieldOff}
        tint="violet"
        label="Blocked by robots"
        value={String(report.blockedByRobots)}
        footnote={blockedFootnote}
        ctaLabel="Review robots"
        ctaHref={`/sitemap${q}`}
      />
      {analysis && (
        <ActionCard
          icon={HeartPulse}
          tint="green"
          label="SEO health score"
          value={String(analysis.healthScore)}
          unit="/ 100"
          footnote={`${analysis.counts.error} error · ${analysis.counts.warning} warning · ${analysis.counts.notice} notice`}
          ctaLabel="View issues"
          ctaHref={`/issues${q}`}
        />
      )}
    </div>
  );
}
