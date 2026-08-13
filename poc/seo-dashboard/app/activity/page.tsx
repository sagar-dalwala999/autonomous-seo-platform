import { History, FileWarning } from "lucide-react";
import { resolveRunId, getRun, getPages } from "@/lib/data";
import { getCrawlStatus } from "@/lib/crawl-runner";
import { hasDurableEventLog, readDurableEvents, readSyntheticEvents } from "@/lib/events-log";
import { EmptyState } from "@/components/ui/empty-state";
import { ActivityStreamClient } from "@/components/activity/activity-stream-client";
import type { ActivityEvent } from "@/components/activity/event-row";

interface Props {
  searchParams: Promise<{ run?: string }>;
}

export default async function ActivityPage({ searchParams }: Props) {
  const { run } = await searchParams;
  const runId = await resolveRunId(run);

  if (!runId) {
    return <EmptyState icon={History} title="No crawl runs yet" description="Start a crawl to see its live activity stream here." />;
  }

  const [{ report }, pages, status] = await Promise.all([getRun(runId), getPages(runId), getCrawlStatus(runId)]);

  if (!report) {
    return <EmptyState icon={FileWarning} title="Run report missing" description={`storage/runs/${runId}/report.json could not be read.`} />;
  }

  const durable = await hasDurableEventLog(runId);
  const initialEvents = (durable ? await readDurableEvents(runId, 0) : (await readSyntheticEvents(runId, 0, null)).events) as ActivityEvent[];
  const source: "durable" | "synthetic" = durable ? "durable" : "synthetic";

  // Only used to resolve an event's url -> page detail link; a run's crawl-status.json (needed for
  // a true "still running" read) is absent for runs not started through this dashboard's own
  // trigger (e.g. crawled directly via CLI) — status is best-effort, the stream itself is truthful
  // regardless (a finished run's SSE connection drains once and closes on its own).
  const urlToPageId: [string, string][] = pages.map((p) => [p.url, p.pageId]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-secondary">
        Run <span className="font-medium text-foreground">{runId}</span> · {report.startUrl}
        {status && <span className="ml-2 text-xs text-faint">({status.state})</span>}
      </p>
      {/* `main` (app-shell.tsx) is a plain overflow-y-auto block, not a flex container, so this
          screen's virtualized list gets its own explicit, bounded height rather than a flex-1 that
          would have no effect here — the list needs a real clientHeight to virtualize against. */}
      <ActivityStreamClient runId={runId} initialEvents={initialEvents} initialSource={source} urlToPageId={urlToPageId} />
    </div>
  );
}
