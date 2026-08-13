"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Search, Download, LayoutGrid, ArrowUpDown, FileWarning, History as HistoryIcon, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatValue } from "@/components/ui/stat-value";
import { Button } from "@/components/ui/button";
import { TableContainer, TableHead, Th, Tr, Td } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";
import { toCsv } from "@/lib/csv";
import { RuleGroupCard } from "./rule-group-card";
import { IssuesFilterChips } from "./issues-filter-chips";
import { FixPlanPanel } from "./fix-plan-panel";
import { HealthTrend } from "./health-trend";
import { PriorityFactors } from "./finding-badges";
import { useMutes } from "./use-mutes";
import {
  groupIssuesByRule,
  groupByArea,
  diffSinceLastCrawl,
  filterIssues,
  type IssueFilterState,
} from "@/lib/issues-view-helpers";
import type { AutomationReport, AutomationLevel, FixPlan, FixPlanItem, HealthHistoryPoint } from "@/lib/data-issue-extras";
import type { Issue, IssueSeverity, FindingReport, WorstPageEntry } from "@/lib/types";

type ViewMode = "area" | "priority" | "worst" | "since";
const VIEW_MODES: { key: ViewMode; label: string; icon: typeof LayoutGrid }[] = [
  { key: "area", label: "By area", icon: LayoutGrid },
  { key: "priority", label: "By priority", icon: ArrowUpDown },
  { key: "worst", label: "Worst pages", icon: FileWarning },
  { key: "since", label: "Since last crawl", icon: HistoryIcon },
];

const SEVERITIES: IssueSeverity[] = ["error", "warning", "notice"];
const AUTOMATION_KEYS: (AutomationLevel | "not-classified")[] = ["auto-safe", "auto-with-review", "human-only", "not-classified"];

export interface IssuesClientProps {
  runId: string;
  healthScore: number;
  pagesAnalyzed: number;
  issues: Issue[];
  counts: Record<IssueSeverity, number>;
  rulesSkippedDataUnavailable: string[];
  pageIdToUrlEntries: [string, string][];
  automation: AutomationReport | null;
  fixPlan: FixPlan | null;
  healthHistory: HealthHistoryPoint[];
  previousRuleCounts: Record<string, number> | null;
  /** Real composite priority per rule (src/analysis/priority/priority.ts). [] on runs that predate it. */
  findings: FindingReport[];
  /** Real per-page harm ranking (src/analysis/priority/worstPages.ts). [] on runs that predate it. */
  worstPages: WorstPageEntry[];
  /** Real server-side mute state for this run's site (report.mutedRuleIds) — see use-mutes.ts. */
  mutedRuleIds: string[];
}

export function IssuesClient({
  runId,
  healthScore,
  pagesAnalyzed,
  issues,
  counts,
  rulesSkippedDataUnavailable,
  pageIdToUrlEntries,
  automation,
  fixPlan,
  healthHistory,
  previousRuleCounts,
  findings,
  worstPages,
  mutedRuleIds: serverMutedRuleIds,
}: IssuesClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const pageIdToUrl = useMemo(() => new Map(pageIdToUrlEntries), [pageIdToUrlEntries]);
  const automationByRule = useMemo(() => {
    const m = new Map<string, AutomationReport["rules"][number]>();
    if (automation) for (const r of automation.rules) m.set(r.ruleId, r);
    return m;
  }, [automation]);
  const automationLevelByRule = useMemo(() => {
    const m = new Map<string, AutomationLevel>();
    for (const [ruleId, r] of automationByRule) m.set(ruleId, r.automation);
    return m;
  }, [automationByRule]);
  const fixPlanByRule = useMemo(() => {
    const m = new Map<string, FixPlanItem[]>();
    if (fixPlan) for (const it of fixPlan.items) m.set(it.rule, [...(m.get(it.rule) ?? []), it]);
    return m;
  }, [fixPlan]);
  const findingsByRule = useMemo(() => new Map(findings.map((f) => [f.ruleId, f])), [findings]);

  const view = (VIEW_MODES.find((v) => v.key === searchParams.get("view"))?.key ?? "area") as ViewMode;
  const activeSeverity = SEVERITIES.includes(searchParams.get("severity") as IssueSeverity) ? (searchParams.get("severity") as IssueSeverity) : null;
  const activeCategory = searchParams.get("category");
  const activeAutomationRaw = searchParams.get("fixType");
  const activeAutomation = AUTOMATION_KEYS.includes(activeAutomationRaw as (typeof AUTOMATION_KEYS)[number])
    ? (activeAutomationRaw as (typeof AUTOMATION_KEYS)[number])
    : null;
  const urlQ = searchParams.get("q") ?? "";

  const [qInput, setQInput] = useState(urlQ);
  const [syncedUrlQ, setSyncedUrlQ] = useState(urlQ);
  if (urlQ !== syncedUrlQ) {
    setSyncedUrlQ(urlQ);
    setQInput(urlQ);
  }
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [fixPlanRuleId, setFixPlanRuleId] = useState<string | null>(null);
  const [showAccepted, setShowAccepted] = useState(false);

  const { isMuted, isPending, mute, unmute } = useMutes(runId, serverMutedRuleIds);

  function updateParams(patch: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  function handleQChange(value: string) {
    setQInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => updateParams({ q: value || null }), 250);
  }

  const categories = useMemo(() => [...new Set(issues.map((i) => i.category))].sort(), [issues]);

  const filterState: IssueFilterState = { q: qInput, severity: activeSeverity, category: activeCategory, automation: activeAutomation };
  const filtered = useMemo(
    () => filterIssues(issues, filterState, automationLevelByRule, pageIdToUrl),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [issues, qInput, activeSeverity, activeCategory, activeAutomation, automationLevelByRule, pageIdToUrl],
  );

  const mutedRuleIdSet = useMemo(() => new Set(serverMutedRuleIds), [serverMutedRuleIds]);
  const activeIssues = useMemo(() => filtered.filter((i) => !mutedRuleIdSet.has(i.ruleId)), [filtered, mutedRuleIdSet]);
  const acceptedIssues = useMemo(() => filtered.filter((i) => mutedRuleIdSet.has(i.ruleId)), [filtered, mutedRuleIdSet]);

  const severityCounts = SEVERITIES.map((key) => ({ key, count: issues.filter((i) => i.severity === key && !mutedRuleIdSet.has(i.ruleId)).length }));
  const automationCounts = AUTOMATION_KEYS.map((key) => ({
    key,
    count: issues.filter((i) => !mutedRuleIdSet.has(i.ruleId) && (automationLevelByRule.get(i.ruleId) ?? "not-classified") === key).length,
  }));

  const activeGroups = useMemo(() => groupIssuesByRule(activeIssues, pagesAnalyzed), [activeIssues, pagesAnalyzed]);
  const acceptedGroups = useMemo(() => groupIssuesByRule(acceptedIssues, pagesAnalyzed), [acceptedIssues, pagesAnalyzed]);
  const areaGroups = useMemo(() => groupByArea(activeGroups), [activeGroups]);
  // Real composite priority (severity x reach x importance x confidence), not the area/severity
  // ordering groupIssuesByRule uses by default — see finding-badges.tsx's PriorityFactors.
  const priorityRankedGroups = useMemo(
    () => [...activeGroups].sort((a, b) => (findingsByRule.get(b.ruleId)?.priority ?? -1) - (findingsByRule.get(a.ruleId)?.priority ?? -1)),
    [activeGroups, findingsByRule],
  );
  const sinceRows = useMemo(() => diffSinceLastCrawl(activeIssues, previousRuleCounts), [activeIssues, previousRuleCounts]);

  function exportCsv() {
    const columns = ["ruleId", "category", "severity", "url", "message", "howToFix", "automation", "effort", "confidence", "accepted"];
    const rows = filtered.map((i) => {
      const summary = automationByRule.get(i.ruleId) ?? null;
      return {
        ruleId: i.ruleId,
        category: i.category,
        severity: i.severity,
        url: i.url ?? (i.pageId ? (pageIdToUrl.get(i.pageId) ?? "") : ""),
        message: i.message,
        howToFix: i.howToFix,
        automation: summary?.automation ?? "not-classified",
        effort: summary?.effort.level ?? "",
        confidence: summary?.confidence ?? "",
        accepted: mutedRuleIdSet.has(i.ruleId) ? "true" : "false",
      };
    });
    const csv = toCsv(rows, columns);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `issues-${runId}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function renderGroup(group: (typeof activeGroups)[number], muted: boolean) {
    return (
      <RuleGroupCard
        key={group.ruleId}
        group={group}
        runId={runId}
        pageIdToUrl={pageIdToUrl}
        automation={automationByRule.get(group.ruleId) ?? null}
        fixPlanItems={fixPlanByRule.get(group.ruleId) ?? []}
        fixPlanAvailable={fixPlan !== null}
        muted={muted}
        mutePending={isPending(group.ruleId)}
        onMuteToggle={(ruleId) => (isMuted(ruleId) ? unmute(ruleId) : mute(ruleId, "accepted from /issues"))}
        onOpenFixPlan={setFixPlanRuleId}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Card className="flex items-center gap-3 lg:col-span-1">
          <StatValue value={healthScore} caption={`Health score · ${pagesAnalyzed} pages`} />
        </Card>
        <Card className="flex items-center gap-3">
          <StatValue value={counts.error} caption="Errors" />
        </Card>
        <Card className="flex items-center gap-3">
          <StatValue value={counts.warning} caption="Warnings" />
        </Card>
        <Card className="flex items-center gap-3">
          <StatValue value={counts.notice} caption="Notices" />
        </Card>
        <Card className="lg:col-span-1">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Health trend</p>
          <HealthTrend history={healthHistory} />
        </Card>
      </div>

      {rulesSkippedDataUnavailable.length > 0 && (
        <p className="text-xs text-faint">
          {rulesSkippedDataUnavailable.length} rule{rulesSkippedDataUnavailable.length === 1 ? "" : "s"} skipped — data not captured in
          this run: {rulesSkippedDataUnavailable.join(", ")}
        </p>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {VIEW_MODES.map((v) => {
            const Icon = v.icon;
            return (
              <button
                key={v.key}
                type="button"
                onClick={() => updateParams({ view: v.key === "area" ? null : v.key })}
                aria-pressed={view === v.key}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-control border px-3 py-1.5 text-xs font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  view === v.key ? "border-primary bg-primary text-primary-contrast" : "border-border bg-subtle text-secondary hover:bg-elevated hover:text-foreground",
                )}
              >
                <Icon size={13} strokeWidth={1.75} aria-hidden="true" />
                {v.label}
              </button>
            );
          })}
          <Button size="sm" variant="outline" className="ml-auto" onClick={exportCsv}>
            <Download size={13} strokeWidth={1.75} aria-hidden="true" />
            Export CSV
          </Button>
        </div>

        <div className="flex h-9 max-w-md items-center gap-2 rounded-control border border-border bg-subtle px-2.5 focus-within:ring-2 focus-within:ring-primary">
          <Search size={14} strokeWidth={1.75} className="shrink-0 text-faint" aria-hidden="true" />
          <input
            type="search"
            value={qInput}
            onChange={(e) => handleQChange(e.target.value)}
            placeholder="Search findings and URLs..."
            aria-label="Search findings and URLs"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-faint outline-none"
          />
        </div>

        <IssuesFilterChips
          severities={severityCounts}
          categories={categories}
          automationLevels={automationCounts}
          activeSeverity={activeSeverity}
          activeCategory={activeCategory}
          activeAutomation={activeAutomation}
          automationDataAvailable={automation !== null}
          onSeverity={(v) => updateParams({ severity: v })}
          onCategory={(v) => updateParams({ category: v })}
          onAutomation={(v) => updateParams({ fixType: v })}
        />
      </div>

      {activeIssues.length === 0 ? (
        <EmptyState icon={FileWarning} title="Nothing matches these filters" description="Try clearing search, severity, fix type, or area." />
      ) : view === "area" ? (
        <div className="space-y-4">
          {areaGroups.map((area) => (
            <div key={area.category} className="space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                {area.category}
                <Badge tone="neutral">{area.groups.reduce((n, g) => n + g.items.length, 0)}</Badge>
              </h3>
              <div className="space-y-2">{area.groups.map((g) => renderGroup(g, false))}</div>
            </div>
          ))}
        </div>
      ) : view === "priority" ? (
        <div className="space-y-3">
          {priorityRankedGroups.map((g) => (
            <div key={g.ruleId} className="space-y-1.5">
              <PriorityFactors finding={findingsByRule.get(g.ruleId) ?? null} />
              {renderGroup(g, false)}
            </div>
          ))}
        </div>
      ) : view === "worst" ? worstPages.length === 0 ? (
        <EmptyState icon={FileWarning} title="Worst-page ranking not available" description="This run predates the priority engine — reanalyze it to get a real per-page harm ranking." />
      ) : (
        <TableContainer>
          <TableHead>
            <Th>Page</Th>
            <Th>Issues</Th>
            <Th>Top rules</Th>
            <Th>Harm</Th>
          </TableHead>
          <tbody>
            {worstPages.map((row) => (
              <Tr key={row.pageId}>
                <Td className="max-w-md truncate normal-case">
                  <a href={`/pages/${row.pageId}?run=${encodeURIComponent(runId)}`} className="text-primary underline underline-offset-2">
                    {row.url}
                  </a>
                </Td>
                <Td>{row.issueCount}</Td>
                <Td className="max-w-xs truncate font-mono text-[11px] normal-case">{row.topRuleIds.join(", ")}</Td>
                <Td className="font-semibold">{row.harm.toFixed(1)}</Td>
              </Tr>
            ))}
          </tbody>
        </TableContainer>
      ) : (
        <TableContainer>
          <TableHead>
            <Th>Rule</Th>
            <Th>Area</Th>
            <Th>Severity</Th>
            <Th>This run</Th>
            <Th>Previous run</Th>
            <Th>Change</Th>
            <Th>Status</Th>
          </TableHead>
          <tbody>
            {previousRuleCounts === null ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-sm text-faint">
                  No earlier judged crawl of this site to compare against yet.
                </td>
              </tr>
            ) : (
              sinceRows.map((row) => (
                <Tr key={row.ruleId}>
                  <Td className="font-mono text-xs normal-case">{row.ruleId}</Td>
                  <Td className="normal-case">{row.category}</Td>
                  <Td className="capitalize normal-case">{row.severity}</Td>
                  <Td>{row.current}</Td>
                  <Td>{row.previous}</Td>
                  <Td className={row.delta > 0 ? "text-danger" : row.delta < 0 ? "text-ok" : "text-faint"}>
                    {row.delta > 0 ? "+" : ""}
                    {row.delta}
                  </Td>
                  <Td className="normal-case">
                    <Badge tone={row.status === "resolved" || row.status === "improved" ? "ok" : row.status === "new" || row.status === "worsened" ? "danger" : "neutral"}>
                      {row.status}
                    </Badge>
                  </Td>
                </Tr>
              ))
            )}
          </tbody>
        </TableContainer>
      )}

      <section className="rounded-card border border-dashed border-border-strong">
        <button
          type="button"
          onClick={() => setShowAccepted((v) => !v)}
          aria-expanded={showAccepted}
          className="flex w-full items-center gap-2 px-5 py-3 text-left text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ChevronRight size={14} strokeWidth={2} className={cn("text-faint transition-transform duration-150", showAccepted && "rotate-90")} aria-hidden="true" />
          Accepted risk
          <Badge tone="neutral">{acceptedGroups.reduce((n, g) => n + g.items.length, 0)}</Badge>
        </button>
        {showAccepted && (
          <div className="space-y-2 border-t border-border p-4">
            {acceptedGroups.length === 0 ? (
              <p className="text-sm text-faint">Nothing accepted yet — findings never disappear, they move here when muted.</p>
            ) : (
              acceptedGroups.map((g) => renderGroup(g, true))
            )}
          </div>
        )}
      </section>

      <FixPlanPanel
        open={fixPlanRuleId !== null}
        onClose={() => setFixPlanRuleId(null)}
        ruleId={fixPlanRuleId}
        items={fixPlanRuleId ? (fixPlanByRule.get(fixPlanRuleId) ?? []) : []}
        available={fixPlan !== null}
        runId={runId}
      />
    </div>
  );
}
