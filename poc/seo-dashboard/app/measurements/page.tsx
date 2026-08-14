import { History, FileWarning } from "lucide-react";
import { resolveRunId } from "@/lib/data";
import { buildMeasurements } from "@/lib/data-measurements";
import { adaptMeasurements } from "@/lib/measurements-view";
import { drilldownSupportedIds } from "@/lib/measurements-drilldown";
import { EmptyState } from "@/components/ui/empty-state";
import { MeasurementsGrid } from "@/components/measurements/measurements-grid";

interface Props {
  searchParams: Promise<{ run?: string }>;
}

export default async function MeasurementsPage({ searchParams }: Props) {
  const { run } = await searchParams;
  const runId = await resolveRunId(run);

  if (!runId) {
    return <EmptyState icon={History} title="No crawl runs yet" description="Run a crawl first to see the measurements grid." />;
  }

  // Call the builder directly rather than fetching this app's own API over HTTP: a server-side
  // self-fetch does not carry the caller's session cookie, so it hit the auth gate and 401'd.
  const json = await buildMeasurements(runId);

  if (!json) {
    return <EmptyState icon={FileWarning} title="Measurements not available" description="No completed run found for this run id." />;
  }

  const data = adaptMeasurements(json, runId);
  const supported = [...(await drilldownSupportedIds())];

  return (
    <div className="space-y-6">
      <p className="text-sm text-secondary">
        Run <span className="font-medium text-foreground">{runId}</span> · {data.pagesInRun.toLocaleString()} page{data.pagesInRun === 1 ? "" : "s"} · generated{" "}
        {new Date(data.generatedAt).toLocaleString()}
      </p>
      <MeasurementsGrid runId={runId} data={data} drilldownSupportedIds={supported} />
    </div>
  );
}
