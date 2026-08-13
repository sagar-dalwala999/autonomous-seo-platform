import { History, GitCompare, CheckCircle2 } from "lucide-react";
import { listRuns, getPages } from "@/lib/data";
import { computeDiff } from "@/lib/data-compare";
import { EmptyState } from "@/components/ui/empty-state";
import { RunPairSelector } from "@/components/compare/run-pair-selector";
import { CompareSummaryTiles } from "@/components/compare/compare-summary-tiles";
import { IssueLifecycleBand } from "@/components/compare/issue-lifecycle-band";
import { AddedRemovedLists } from "@/components/compare/added-removed-lists";
import { ChangedPagesTable } from "@/components/compare/changed-pages-table";

interface Props {
  searchParams: Promise<{ base?: string; head?: string }>;
}

export default async function ComparePage({ searchParams }: Props) {
  const sp = await searchParams;
  const runs = await listRuns();

  if (runs.length === 0) {
    return <EmptyState icon={History} title="No crawl runs yet" description="Compare needs at least two runs — crawl a site, then crawl it again to see what changed." />;
  }

  const validIds = new Set(runs.map((r) => r.runId));
  let baseRunId = sp.base && validIds.has(sp.base) ? sp.base : null;
  let headRunId = sp.head && validIds.has(sp.head) ? sp.head : null;

  // Default to the two most recent runs when nothing is selected (listRuns is startedAt desc).
  if (!baseRunId && !headRunId && runs.length >= 2) {
    headRunId = runs[0]!.runId;
    baseRunId = runs[1]!.runId;
  }

  if (runs.length < 2) {
    return (
      <div className="space-y-6">
        <RunPairSelector runs={runs} baseRunId={baseRunId} headRunId={headRunId} />
        <EmptyState icon={GitCompare} title="Only one run recorded" description="Crawl this site again to get a second run — Compare needs two to show what changed." />
      </div>
    );
  }

  if (!baseRunId || !headRunId) {
    return (
      <div className="space-y-6">
        <RunPairSelector runs={runs} baseRunId={baseRunId} headRunId={headRunId} />
        <EmptyState icon={GitCompare} title="Pick two runs to compare" description="Choose a base (before) and a head (after) run above." />
      </div>
    );
  }

  if (baseRunId === headRunId) {
    return (
      <div className="space-y-6">
        <RunPairSelector runs={runs} baseRunId={baseRunId} headRunId={headRunId} />
        <EmptyState icon={GitCompare} title="Pick two different runs" description="Base and head are the same run — choose two distinct runs to see what changed." />
      </div>
    );
  }

  const [diff, basePages, headPages] = await Promise.all([
    computeDiff(baseRunId, headRunId),
    getPages(baseRunId),
    getPages(headRunId),
  ]);

  const identical = diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0;

  return (
    <div className="space-y-6">
      <RunPairSelector runs={runs} baseRunId={baseRunId} headRunId={headRunId} />

      <p className="text-sm text-secondary">
        Comparing <span className="font-medium text-foreground">{diff.baseRunId}</span> (base) against{" "}
        <span className="font-medium text-foreground">{diff.headRunId}</span> (head) · {basePages.length + headPages.length > 0 ? `${basePages.length} + ${headPages.length} pages loaded` : ""}
      </p>

      <CompareSummaryTiles diff={diff} />

      <IssueLifecycleBand diff={diff} />

      {identical ? (
        <EmptyState
          icon={CheckCircle2}
          title="These runs are identical"
          description={`${diff.unchangedCount} page${diff.unchangedCount === 1 ? "" : "s"} matched with zero field changes — nothing was added, removed, or changed.`}
        />
      ) : (
        <>
          <AddedRemovedLists added={diff.added} removed={diff.removed} baseRunId={baseRunId} headRunId={headRunId} basePages={basePages} headPages={headPages} />
          {diff.changed.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-foreground">Changed pages ({diff.changed.length})</h2>
              <ChangedPagesTable changed={diff.changed} headRunId={headRunId} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
