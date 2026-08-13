import { headers } from "next/headers";
import { History, FileWarning } from "lucide-react";
import { resolveRunId } from "@/lib/data";
import { adaptMeasurements } from "@/lib/measurements-view";
import { drilldownSupportedIds } from "@/lib/measurements-drilldown";
import { EmptyState } from "@/components/ui/empty-state";
import { MeasurementsGrid } from "@/components/measurements/measurements-grid";

interface Props {
  searchParams: Promise<{ run?: string }>;
}

/** Derives this running instance's own origin from the incoming request rather than hardcoding
 *  the package.json dev port (3100) — QA/verification runs this app on a spare port (e.g. 3901)
 *  and must fetch itself, not whatever else happens to be listening on 3100. */
async function selfOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3100";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

export default async function MeasurementsPage({ searchParams }: Props) {
  const { run } = await searchParams;
  const runId = await resolveRunId(run);

  if (!runId) {
    return <EmptyState icon={History} title="No crawl runs yet" description="Run a crawl first to see the measurements grid." />;
  }

  const origin = await selfOrigin();
  const res = await fetch(`${origin}/api/crawls/${encodeURIComponent(runId)}/measurements`, { cache: "no-store" });

  if (!res.ok) {
    return (
      <EmptyState
        icon={FileWarning}
        title="Measurements not available"
        description={res.status === 404 ? "No completed run found for this run id." : `The measurements endpoint returned HTTP ${res.status}.`}
      />
    );
  }

  const json = await res.json();
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
