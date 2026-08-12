import Link from "next/link";
import { History, Sparkles, CheckCircle2, ShieldQuestion } from "lucide-react";
import { resolveRunId, getPages } from "@/lib/data";
import { readAnalysisReport, groupIssuesByRule } from "@/lib/data-issues";
import { findPageIdByUrl } from "@/lib/data-explorer";
import { EmptyState } from "@/components/ui/empty-state";
import { IssuesSummaryBand } from "@/components/issues/issues-summary-band";
import { IssuesFilterChips } from "@/components/issues/issues-filter-chips";
import { RuleGroupCard } from "@/components/issues/rule-group-card";
import type { IssueSeverity } from "@/lib/types";

interface Props {
  searchParams: Promise<{ run?: string; severity?: string; category?: string }>;
}

const SEVERITIES: IssueSeverity[] = ["error", "warning", "notice"];

export default async function IssuesPage({ searchParams }: Props) {
  const sp = await searchParams;
  const runId = await resolveRunId(sp.run);

  if (!runId) {
    return <EmptyState icon={History} title="No crawl runs yet" description="Run a crawl first, then analyze it to see issues here." />;
  }

  const [report, { items: pages }] = await Promise.all([readAnalysisReport(runId), getPages(runId, {})]);

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

  const activeSeverity = SEVERITIES.includes(sp.severity as IssueSeverity) ? (sp.severity as IssueSeverity) : null;
  const activeCategory = sp.category ?? null;

  let filtered = report.issues;
  if (activeSeverity) filtered = filtered.filter((i) => i.severity === activeSeverity);
  if (activeCategory) filtered = filtered.filter((i) => i.category === activeCategory);

  const categories = [...new Set(report.issues.map((i) => i.category))].sort();
  const severityCounts = SEVERITIES.map((key) => ({ key, count: report.counts[key] ?? 0 }));
  const groups = groupIssuesByRule(filtered, report.pagesAnalyzed);
  const pageIdToUrl = new Map(pages.map((p) => [p.pageId, p.url]));

  return (
    <div className="space-y-6">
      <p className="text-sm text-secondary">
        Run <span className="font-medium text-foreground">{runId}</span> · rulebook v{report.rulebookVersion} · generated{" "}
        {new Date(report.generatedAt).toLocaleString()}
      </p>

      <IssuesSummaryBand report={report} />

      <IssuesFilterChips
        runId={runId}
        severities={severityCounts}
        categories={categories}
        activeSeverity={activeSeverity}
        activeCategory={activeCategory}
      />

      {report.rulesSkippedDataUnavailable.length > 0 && (
        <p className="text-xs text-faint">
          {report.rulesSkippedDataUnavailable.length} rule{report.rulesSkippedDataUnavailable.length === 1 ? "" : "s"} skipped — data
          not captured in this run: {report.rulesSkippedDataUnavailable.join(", ")}
        </p>
      )}

      {report.issues.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="This run is clean"
          description={`Health score ${report.healthScore} · ${report.pagesAnalyzed} pages analyzed, zero rule violations.`}
        />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No issues match this filter"
          description={
            <Link href={`/issues?run=${encodeURIComponent(runId)}`} className="text-primary underline underline-offset-2">
              Clear filters
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <RuleGroupCard
              key={g.ruleId}
              group={g}
              runId={runId}
              pageIdToUrl={pageIdToUrl}
              resolvePageId={(url) => findPageIdByUrl(pages, url)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
