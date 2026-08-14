import Link from "next/link";
import { LayoutGrid, Gauge } from "lucide-react";
import { listRuns, getRun, getPages, resolveRunId } from "@/lib/data";
import { buildHexMatrix, buildTimeline, buildWorkQueue, buildKpiStrip } from "@/lib/data-overview";
import { buildMeasurements } from "@/lib/data-measurements";
import { adaptMeasurements } from "@/lib/measurements-view";
import { drilldownSupportedIds } from "@/lib/measurements-drilldown";
import { readAnalysisReport } from "@/lib/data-issues";
import { EmptyState } from "@/components/ui/empty-state";
import { HealthScoreHero } from "@/components/overview/health-score-hero";
import { ActionCards } from "@/components/overview/action-cards";
import { KpiStripView } from "@/components/overview/kpi-strip";
import { HexMatrix } from "@/components/charts/hex-matrix";
import { DotMatrixTimeline } from "@/components/charts/dot-matrix-timeline";
import { WorkQueueTable } from "@/components/overview/work-queue-table";
import { FilterChips } from "@/components/overview/filter-chips";
import { OverviewTopbarActions } from "@/components/overview/overview-topbar-actions";
import { NewCrawlTriggerButton } from "@/components/overview/new-crawl-trigger-button";
import { MeasurementsGrid } from "@/components/measurements/measurements-grid";

interface Props {
  searchParams: Promise<{ run?: string }>;
}

async function loadPreviousRun(previousRunId: string | undefined) {
  if (!previousRunId) return { report: null, pages: null };
  const { report } = await getRun(previousRunId);
  if (!report) return { report: null, pages: null };
  return { report, pages: await getPages(previousRunId) };
}

export default async function OverviewPage({ searchParams }: Props) {
  const { run } = await searchParams;
  const runs = await listRuns();

  if (runs.length === 0) {
    return (
      <>
        <OverviewTopbarActions report={null} />
        <EmptyState
          icon={LayoutGrid}
          title="No crawl runs yet"
          description={
            <>
              Run a crawl from{" "}
              <code className="rounded border border-border bg-elevated px-1 py-0.5 text-[11px]">seo-crawler-poc</code>{" "}
              or trigger one right from here.
            </>
          }
          action={<NewCrawlTriggerButton label="Crawl your first site" />}
        />
      </>
    );
  }

  const runId = (await resolveRunId(run)) ?? runs[0].runId;
  const currentIndex = runs.findIndex((r) => r.runId === runId);
  const previousRunItem = currentIndex >= 0 ? runs[currentIndex + 1] : undefined;

  const [[{ report, blocked, failures }, pages], measurementsJson, supportedIds, analysisReport] = await Promise.all([
    Promise.all([getRun(runId), getPages(runId)]),
    buildMeasurements(runId),
    drilldownSupportedIds().then((ids) => [...ids]),
    readAnalysisReport(runId),
  ]);

  if (!report) {
    return (
      <>
        <OverviewTopbarActions report={null} />
        <EmptyState icon={LayoutGrid} title="Run report missing" description={`storage/runs/${runId}/report.json could not be read.`} />
      </>
    );
  }

  const measurementsData = measurementsJson ? adaptMeasurements(measurementsJson, runId) : null;
  const { report: previousReport, pages: previousPages } = await loadPreviousRun(previousRunItem?.runId);

  const hexData = buildHexMatrix(pages, blocked);
  const timeline = buildTimeline(pages);
  const workQueue = buildWorkQueue(pages, failures, report.orphanCandidates);
  const kpiStrip = buildKpiStrip(report, pages, previousReport, previousPages);

  return (
    <div className="space-y-6">
      <OverviewTopbarActions report={report} />

      {/* Quick Status Navigation Filter Chips */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <FilterChips report={report} runId={runId} pages={pages} failureCount={failures.length} blockedCount={blocked.length} />
      </div>

      {/* Hero Health Score Gauge & Top Fixes */}
      <HealthScoreHero report={analysisReport} runId={runId} />

      {/* Compact Action Metric Cards */}
      <ActionCards report={report} runId={runId} />

      {/* Trend strip: the four crawl-level KPIs with deltas vs the previous run — restored from
          the earlier design (buildKpiStrip was already computed below), with a one-click jump to
          the full compare view when there IS a previous run to diff against. */}
      <div className="space-y-2">
        <KpiStripView strip={kpiStrip} runId={runId} />
        {previousRunItem && (
          <p className="text-xs text-faint">
            Comparing against{" "}
            <Link
              href={`/compare?base=${encodeURIComponent(previousRunItem.runId)}&head=${encodeURIComponent(runId)}`}
              className="text-primary underline underline-offset-2 hover:opacity-80"
            >
              the previous crawl
            </Link>{" "}
            · view the full{" "}
            <Link href={`/compare?base=${encodeURIComponent(previousRunItem.runId)}&head=${encodeURIComponent(runId)}`} className="text-primary underline underline-offset-2 hover:opacity-80">
              run comparison
            </Link>
          </p>
        )}
      </div>

      {/* <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <HexMatrix cells={hexData.cells} legend={hexData.legend} runId={runId} />
        </div>
        <div className="lg:col-span-2">
          <DotMatrixTimeline data={timeline} runId={runId} />
        </div>
      </div> */}

      {measurementsData && (
        <section className="space-y-4 pt-2">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-border pb-3">
            <div>
              <div className="flex items-center gap-2">
                <Gauge size={18} className="text-primary" />
                <h2 className="text-base font-semibold text-foreground">Technical SEO Measurements</h2>
              </div>
              <p className="text-xs text-secondary mt-0.5">
                Comprehensive technical SEO indicators across indexability, content quality, links, head metadata, and performance.
              </p>
            </div>
            {/* "Full screen view" link to /measurements removed per owner request 2026-08-14 —
                the measurements grid renders inline here; the /measurements page is unreachable. */}
          </div>
          <MeasurementsGrid runId={runId} data={measurementsData} drilldownSupportedIds={supportedIds} />
        </section>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-foreground">Pages that need you</h2>
        <WorkQueueTable rows={workQueue} runId={runId} />
      </div>
    </div>
  );
}
