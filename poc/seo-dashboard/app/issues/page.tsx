import { History, ShieldQuestion } from "lucide-react";
import { resolveRunId, getPages, getRun } from "@/lib/data";
import { readAnalysisReport } from "@/lib/data-issues";
import { readAutomationReport, readFixPlan, readHealthHistory } from "@/lib/data-issue-extras";
import { EmptyState } from "@/components/ui/empty-state";
import { IssuesClient } from "@/components/issues/issues-client";

interface Props {
  searchParams: Promise<{ run?: string }>;
}

export default async function IssuesPage({ searchParams }: Props) {
  const sp = await searchParams;
  const runId = await resolveRunId(sp.run);

  if (!runId) {
    return <EmptyState icon={History} title="No crawl runs yet" description="Run a crawl first, then analyze it to see issues here." />;
  }

  const [report, pages, { report: summary }] = await Promise.all([readAnalysisReport(runId), getPages(runId), getRun(runId)]);

  if (!report) {
    return (
      <EmptyState
        icon={ShieldQuestion}
        title="This run hasn't been analyzed"
        description={
          <>
            Run{" "}
            <code className="rounded border border-border bg-elevated px-1 py-0.5 text-[11px]">
              npm run analyze -- --run {runId}
            </code>{" "}
            from <code className="rounded border border-border bg-elevated px-1 py-0.5 text-[11px]">seo-crawler-poc</code> to generate
            issues.json for this run.
          </>
        }
      />
    );
  }

  const [automation, fixPlan, healthHistory] = await Promise.all([
    readAutomationReport(runId),
    readFixPlan(runId),
    summary ? readHealthHistory(summary.startUrl) : Promise.resolve([]),
  ]);

  // Walk backward from the current run to the nearest EARLIER entry that was actually analyzed —
  // healthHistory can contain crawls with no issues.json (ruleCounts: null) interleaved between
  // analyzed ones, and the immediately-preceding array index is not necessarily analyzed.
  const currentIndex = healthHistory.findIndex((h) => h.runId === runId);
  let previousRuleCounts: Record<string, number> | null = null;
  for (let i = currentIndex - 1; i >= 0; i--) {
    if (healthHistory[i].ruleCounts !== null) {
      previousRuleCounts = healthHistory[i].ruleCounts;
      break;
    }
  }

  const pageIdToUrlEntries: [string, string][] = pages.map((p) => [p.pageId, p.url]);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-faint">SEO rules</p>
        <h2 className="text-2xl font-semibold leading-tight tracking-tight text-foreground">What needs fixing.</h2>
      </header>

      {report.issues.length === 0 ? (
        <EmptyState
          icon={ShieldQuestion}
          title="This run is clean"
          description={`Health score ${report.healthScore} · ${report.pagesAnalyzed} pages analyzed, zero rule violations.`}
        />
      ) : (
        <IssuesClient
          runId={runId}
          pagesAnalyzed={report.pagesAnalyzed}
          issues={report.issues}
          counts={report.counts}
          rulesSkippedDataUnavailable={report.rulesSkippedDataUnavailable}
          pageIdToUrlEntries={pageIdToUrlEntries}
          automation={automation}
          fixPlan={fixPlan}
          previousRuleCounts={previousRuleCounts}
          findings={report.findings ?? []}
          worstPages={report.worstPages ?? []}
          mutedRuleIds={report.mutedRuleIds ?? []}
        />
      )}
    </div>
  );
}
