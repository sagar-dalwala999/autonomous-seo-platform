import { History } from "lucide-react";
import { resolveRunId } from "@/lib/data";
import { buildImageRows } from "@/lib/data-images";
import { EmptyState } from "@/components/ui/empty-state";
import { ImagesClient } from "@/components/images/images-client";

interface Props {
  searchParams: Promise<{ run?: string }>;
}

export default async function ImagesPage({ searchParams }: Props) {
  const sp = await searchParams;
  const runId = await resolveRunId(sp.run);

  if (!runId) {
    return <EmptyState icon={History} title="No crawl runs yet" description="Run a crawl to see its images here." />;
  }

  const rows = await buildImageRows(runId);

  return (
    <div className="space-y-4">
      <p className="text-sm text-secondary">
        Run <span className="font-medium text-foreground">{runId}</span> · {rows.length} unique image{rows.length === 1 ? "" : "s"}
      </p>
      {rows.length === 0 ? (
        <EmptyState icon={History} title="No images recorded" description="This run has no images captured yet." />
      ) : (
        <ImagesClient rows={rows} runId={runId} />
      )}
    </div>
  );
}
