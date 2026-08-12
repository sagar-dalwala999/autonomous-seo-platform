import { Suspense } from "react";
import { History, FileText } from "lucide-react";
import { resolveRunId } from "@/lib/data";
import { buildExplorerRows } from "@/lib/data-explorer";
import { EmptyState } from "@/components/ui/empty-state";
import { PagesExplorerClient } from "@/components/explorer/pages-explorer-client";

interface Props {
  searchParams: Promise<{ run?: string }>;
}

export default async function PagesPage({ searchParams }: Props) {
  const { run } = await searchParams;
  const runId = await resolveRunId(run);

  if (!runId) {
    return (
      <EmptyState
        icon={History}
        title="No crawl runs yet"
        description="Pages explorer reads storage/runs/<runId>/pages/*.json — run a crawl first."
      />
    );
  }

  const rows = await buildExplorerRows(runId);

  if (rows.length === 0) {
    return <EmptyState icon={FileText} title="No pages recorded for this run" />;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-secondary">
        Run <span className="font-medium text-foreground">{runId}</span>
      </p>
      <Suspense fallback={null}>
        <PagesExplorerClient rows={rows} runId={runId} />
      </Suspense>
    </div>
  );
}
