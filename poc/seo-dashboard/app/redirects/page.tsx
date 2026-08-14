import { History } from "lucide-react";
import { resolveRunId } from "@/lib/data";
import { buildRedirectRows } from "@/lib/data-redirects";
import { EmptyState } from "@/components/ui/empty-state";
import { RedirectsClient } from "@/components/redirects/redirects-client";

interface Props {
  searchParams: Promise<{ run?: string }>;
}

export default async function RedirectsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const runId = await resolveRunId(sp.run);

  if (!runId) {
    return <EmptyState icon={History} title="No crawl runs yet" description="Run a crawl to see its redirects here." />;
  }

  const rows = await buildRedirectRows(runId);

  return (
    <div className="space-y-4">
      <p className="text-sm text-secondary">
        Run <span className="font-medium text-foreground">{runId}</span> · {rows.length} redirect{rows.length === 1 ? "" : "s"}
      </p>
      {rows.length === 0 ? (
        <EmptyState icon={History} title="No redirects recorded" description="This run has no redirect chains." />
      ) : (
        <RedirectsClient rows={rows} runId={runId} />
      )}
    </div>
  );
}
