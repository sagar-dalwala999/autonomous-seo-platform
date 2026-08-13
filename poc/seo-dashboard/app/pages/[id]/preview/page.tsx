import { stat } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { ArrowLeft, FileSearch } from "lucide-react";
import { resolveRunId, getPage, runsDir } from "@/lib/data";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageReplay } from "@/components/preview/page-replay";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ run?: string }>;
}

export default async function PagePreviewPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const runId = await resolveRunId(sp.run);
  const page = runId ? await getPage(runId, id) : null;

  if (!runId || !page) {
    return (
      <EmptyState
        icon={FileSearch}
        title="Page record not found"
        description={
          <>
            No <code className="rounded border border-border bg-elevated px-1 py-0.5 text-[11px]">{id}.json</code> under this
            run.{" "}
            <Link href="/pages" className="text-primary underline underline-offset-2">
              Back to Pages
            </Link>
          </>
        }
      />
    );
  }

  const hasStaticHtml = await stat(path.join(runsDir(), runId, "raw", `${page.pageId}.static.html`))
    .then(() => true)
    .catch(() => false);

  return (
    <div className="space-y-4 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/pages/${id}?run=${encodeURIComponent(runId)}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-primary underline underline-offset-2"
        >
          <ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />
          Back to page evidence
        </Link>
      </div>

      <Card className="space-y-1 bg-subtle">
        <h1 className="text-base font-semibold text-foreground">Page replay</h1>
        <p className="text-xs text-secondary">What the crawler actually captured for this page — rendered locally from stored HTML, not re-fetched from the live site.</p>
      </Card>

      <PageReplay
        runId={runId}
        pageId={page.pageId}
        pageUrl={page.url}
        statusCode={page.statusCode}
        fetchedAt={page.fetchedAt}
        hasStaticHtml={hasStaticHtml}
      />
    </div>
  );
}
