import { LayoutGrid } from "lucide-react";
import { listRuns, getRun, getPages, resolveRunId } from "@/lib/data";
import { buildHexMatrix, buildTimeline, buildWorkQueue, buildKpiStrip } from "@/lib/data-overview";
import { EmptyState } from "@/components/ui/empty-state";
import { ActionCards } from "@/components/overview/action-cards";
import { KpiStripView } from "@/components/overview/kpi-strip";
import { HexMatrix } from "@/components/charts/hex-matrix";
import { DotMatrixTimeline } from "@/components/charts/dot-matrix-timeline";
import { WorkQueueTable } from "@/components/overview/work-queue-table";
import { FilterChips } from "@/components/overview/filter-chips";
import { OverviewTopbarActions } from "@/components/overview/overview-topbar-actions";
import { NewCrawlTriggerButton } from "@/components/overview/new-crawl-trigger-button";

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

  const [{ report, blocked, failures }, pages] = await Promise.all([getRun(runId), getPages(runId)]);

  if (!report) {
    return (
      <>
        <OverviewTopbarActions report={null} />
        <EmptyState icon={LayoutGrid} title="Run report missing" description={`storage/runs/${runId}/report.json could not be read.`} />
      </>
    );
  }

  const { report: previousReport, pages: previousPages } = await loadPreviousRun(previousRunItem?.runId);

  const hexData = buildHexMatrix(pages, blocked);
  const timeline = buildTimeline(pages);
  const workQueue = buildWorkQueue(pages, failures, report.orphanCandidates);
  const kpiStrip = buildKpiStrip(report, pages, previousReport, previousPages);

  return (
    <div className="space-y-6">
      <OverviewTopbarActions report={report} />

      {/* Run selector now lives in the topbar (components/shell/topbar.tsx) so it's on every data page. */}
      <FilterChips report={report} runId={runId} pages={pages} failureCount={failures.length} blockedCount={blocked.length} />

      <ActionCards report={report} runId={runId} />

      <KpiStripView strip={kpiStrip} runId={runId} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <HexMatrix cells={hexData.cells} legend={hexData.legend} runId={runId} />
        </div>
        <div className="lg:col-span-2">
          <DotMatrixTimeline data={timeline} runId={runId} />
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-foreground">Pages that need you</h2>
        <WorkQueueTable rows={workQueue} runId={runId} />
      </div>
    </div>
  );
}
