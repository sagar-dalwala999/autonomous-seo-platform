"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ChevronRight, FileWarning, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableContainer, TableHead, Th, Tr, Td } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { toCsv } from "@/lib/csv";
import { KpiTiles, type KpiTileSpec } from "./kpi-tiles";
import { IssuesToolbar, type IssueGroup } from "./issues-toolbar";
import { FindingRow, humanizeRuleId } from "./finding-row";
import { GroupSection } from "./group-section";
import { GroupNav } from "./group-nav";
import { FullFixPlan } from "./full-fix-plan";
import { FixPlanPanel } from "./fix-plan-panel";
import { useMutes } from "./use-mutes";
import {
  groupIssuesByRule,
  groupByArea,
  diffSinceLastCrawl,
  filterIssues,
  type RuleGroupLite,
} from "@/lib/issues-view-helpers";
import type { AutomationReport, AutomationLevel, FixPlan, FixPlanItem } from "@/lib/data-issue-extras";
import type { Issue, IssueSeverity, FindingReport, WorstPageEntry } from "@/lib/types";

const SEVERITIES: IssueSeverity[] = ["error", "warning", "notice"];
const AUTOMATION_KEYS: (AutomationLevel | "not-classified")[] = ["auto-safe", "auto-with-review", "human-only", "not-classified"];
const AUTOMATION_LABEL: Record<AutomationLevel | "not-classified", string> = {
  "auto-safe": "⚡ Auto-safe",
  "auto-with-review": "◐ Needs review",
  "human-only": "✋ Human only",
  "not-classified": "Not classified",
};

/** Unifies the four view headings — plain title with a muted sub-note, matching the app's cards. */
function SectionHeading({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {sub && <span className="text-xs text-faint">{sub}</span>}
    </div>
  );
}

export interface IssuesClientProps {
  runId: string;
  pagesAnalyzed: number;
  issues: Issue[];
  counts: Record<IssueSeverity, number>;
  rulesSkippedDataUnavailable: string[];
  pageIdToUrlEntries: [string, string][];
  automation: AutomationReport | null;
  fixPlan: FixPlan | null;
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
  pagesAnalyzed,
  issues,
  counts,
  rulesSkippedDataUnavailable,
  pageIdToUrlEntries,
  automation,
  fixPlan,
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

  const group = (["area", "priority", "worst", "since"].find((v) => v === searchParams.get("view")) ?? "area") as IssueGroup;
  // "worst" view has two page-first modes: the harm ranking (default) or the clean-pages listing
  const worstMode = searchParams.get("worst") === "clean" ? "clean" : "issues";
  const show = ["failing", "all", "passed"].includes(searchParams.get("show") ?? "") ? (searchParams.get("show") as string) : "failing";
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
  const [planOpen, setPlanOpen] = useState(false);

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

  const mutedRuleIdSet = useMemo(() => new Set(serverMutedRuleIds), [serverMutedRuleIds]);

  /* ── filtering ──────────────────────────────────────────────────────────────────────── */
  const filtered = useMemo(
    () =>
      filterIssues(
        issues,
        { q: qInput, severity: activeSeverity, category: activeCategory, automation: activeAutomation },
        automationLevelByRule,
        pageIdToUrl,
      ),
    [issues, qInput, activeSeverity, activeCategory, activeAutomation, automationLevelByRule, pageIdToUrl],
  );
  const activeIssues = useMemo(() => filtered.filter((i) => !mutedRuleIdSet.has(i.ruleId)), [filtered, mutedRuleIdSet]);
  const acceptedIssues = useMemo(() => filtered.filter((i) => mutedRuleIdSet.has(i.ruleId)), [filtered, mutedRuleIdSet]);

  // distinct pages touched by ALL unmuted findings (filter-independent, like the reference's
  // totals.uniquePagesAffected) — pageId/url plus any secondary pageIds in evidence. The same
  // key set backs both the "pages with issues" tile and the clean-pages listing, so a page can
  // never count as both.
  const allIssuesUnmuted = useMemo(() => issues.filter((i) => !mutedRuleIdSet.has(i.ruleId)), [issues, mutedRuleIdSet]);
  const affectedPageKeys = useMemo(() => {
    const seen = new Set<string>();
    for (const i of allIssuesUnmuted) {
      seen.add(i.pageId ?? i.url ?? `${i.ruleId}-site`);
      for (const e of i.evidence) if (e.pageId) seen.add(e.pageId);
    }
    return seen;
  }, [allIssuesUnmuted]);
  const uniquePagesAffected = affectedPageKeys.size;

  /* ── groups ─────────────────────────────────────────────────────────────────────────── */
  const failingGroups = useMemo(() => groupIssuesByRule(activeIssues, pagesAnalyzed), [activeIssues, pagesAnalyzed]);
  const passingGroups = useMemo(() => {
    // "All rules" / "Passing" views need the rules that fired zero times — only available from
    // the priority slice (report.findings). [] on runs that predate it → views degrade to the
    // failing list rather than fabricate a rulebook.
    const passing = findings.filter((f) => f.status === "passed" && !mutedRuleIdSet.has(f.ruleId));
    return passing.map<RuleGroupLite>((f) => ({
      ruleId: f.ruleId,
      category: f.category,
      severity: f.severity,
      howToFix: f.howToFix,
      affectedPageCount: 0,
      affectedPercent: 0,
      items: [],
    }));
  }, [findings, mutedRuleIdSet]);

  // group-level filters, mirroring the reference module: severity, fix type, then search over
  // the finding AND the URLs it names ("what is wrong with /pricing" is the question people
  // arrive with, and a rule title never contains a path).
  const groups = useMemo(() => {
    let list: RuleGroupLite[];
    if (show === "passed") list = passingGroups;
    else if (show === "all") list = [...failingGroups, ...passingGroups];
    else list = failingGroups;

    if (activeSeverity) list = list.filter((g) => g.severity === activeSeverity);
    if (activeAutomation) {
      list = list.filter((g) => {
        const level = automationLevelByRule.get(g.ruleId) ?? null;
        return activeAutomation === "not-classified" ? level === null : level === activeAutomation;
      });
    }
    const needle = qInput.trim().toLowerCase();
    if (needle) {
      list = list.filter((g) => {
        const finding = findingsByRule.get(g.ruleId);
        const hay = `${humanizeRuleId(g.ruleId)} ${g.category} ${finding?.why ?? g.items[0]?.message ?? ""} ${g.howToFix}`.toLowerCase();
        if (hay.includes(needle)) return true;
        return g.items.some((i) => {
          const url = i.url ?? (i.pageId ? pageIdToUrl.get(i.pageId) : undefined) ?? "";
          return url.toLowerCase().includes(needle) || i.message.toLowerCase().includes(needle);
        });
      });
    }
    return list;
  }, [show, failingGroups, passingGroups, activeSeverity, activeAutomation, automationLevelByRule, qInput, findingsByRule, pageIdToUrl]);

  const areaGroups = useMemo(() => groupByArea(groups), [groups]);
  const priorityRanked = useMemo(
    () => [...groups].sort((a, b) => (findingsByRule.get(b.ruleId)?.priority ?? -1) - (findingsByRule.get(a.ruleId)?.priority ?? -1)),
    [groups, findingsByRule],
  );
  const acceptedGroups = useMemo(() => groupIssuesByRule(acceptedIssues, pagesAnalyzed), [acceptedIssues, pagesAnalyzed]);
  const sinceRows = useMemo(() => diffSinceLastCrawl(activeIssues, previousRuleCounts), [activeIssues, previousRuleCounts]);

  /* ── headline numbers ───────────────────────────────────────────────────────────────── */
  const automationRuleCounts = useMemo(() => {
    const m = new Map<(typeof AUTOMATION_KEYS)[number], number>();
    for (const key of AUTOMATION_KEYS) m.set(key, 0);
    const seen = new Set<string>();
    for (const i of activeIssues) {
      const ruleId = i.ruleId;
      if (seen.has(ruleId)) continue;
      seen.add(ruleId);
      const level = automationLevelByRule.get(ruleId) ?? "not-classified";
      m.set(level, (m.get(level) ?? 0) + 1);
    }
    return m;
  }, [activeIssues, automationLevelByRule]);
  const automationOptions = [
    { value: "any", label: "All" },
    ...AUTOMATION_KEYS.map((key) => ({ value: key, label: AUTOMATION_LABEL[key], count: automationRuleCounts.get(key) ?? 0 })),
  ];

  const autoFixable = fixPlan?.totalChanges ?? automation?.counts["auto-safe"] ?? 0;
  const cleanPages = Math.max(0, pagesAnalyzed - uniquePagesAffected);
  // the pages behind the "clean pages" number — every crawled page not touched by an unmuted
  // finding (keys match affectedPageKeys so the two tiles always sum to the site)
  const cleanPageEntries = useMemo(
    () => pageIdToUrlEntries.filter(([pageId, url]) => !affectedPageKeys.has(pageId) && !affectedPageKeys.has(url)),
    [pageIdToUrlEntries, affectedPageKeys],
  );
  const filtersActive = show !== "failing" || activeSeverity !== null || activeAutomation !== null;

  const clearAll = () => updateParams({ show: null, severity: null, fixType: null, q: null });

  // clicking a severity tile forces the list back to "needs fixing" — clicking "3 critical"
  // and being shown passing rules would be absurd
  const sevTile = (sev: IssueSeverity): Omit<KpiTileSpec, "value" | "label"> => ({
    onClick: () => updateParams({ show: "failing", severity: activeSeverity === sev ? null : sev }),
    active: activeSeverity === sev,
    dot: sev === "error" ? "bad" : sev === "warning" ? "warn" : "neutral",
  });

  // the two page tiles switch to the page-first (worst) view — "pages with issues" ranks the
  // pages that have them, "clean pages" lists the pages that don't; clicking the active tile
  // returns to By area
  const pageTile = (mode: "issues" | "clean"): Omit<KpiTileSpec, "value" | "label"> => {
    const active = group === "worst" && worstMode === mode;
    return {
      onClick: () => updateParams({ view: active ? null : "worst", worst: active || mode === "issues" ? null : "clean" }),
      active,
      activeLabel: "viewing",
    };
  };

  const kpiTiles: KpiTileSpec[] = [
    { ...sevTile("error"), value: counts.error, label: "critical" },
    { ...sevTile("warning"), value: counts.warning, label: "warnings" },
    { ...sevTile("notice"), value: counts.notice, label: "notices" },
    { ...pageTile("issues"), value: uniquePagesAffected.toLocaleString(), label: "pages with issues" },
    { ...pageTile("clean"), value: cleanPages.toLocaleString(), label: "clean pages", dot: "ok" },
    {
      value: autoFixable,
      label: "auto-fixable changes",
      dot: "ok",
      onClick: () => updateParams({ view: "priority", fixType: activeAutomation === "auto-safe" ? null : "auto-safe" }),
      active: activeAutomation === "auto-safe",
    },
    // shown only once something has been accepted, so a clean site is not asked to explain a
    // zero it has no context for
    ...(serverMutedRuleIds.length > 0 ? [{ value: serverMutedRuleIds.length, label: "accepted risks" } satisfies KpiTileSpec] : []),
  ];

  // counts per area for the rail: what is still firing, and whether any of it is critical
  const navCounts = Object.fromEntries(
    areaGroups.map((a) => [
      a.category,
      {
        firing: a.groups.filter((g) => g.items.length > 0).length,
        critical: a.groups.filter((g) => g.items.length > 0 && g.severity === "error").length,
      },
    ]),
  );

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

  const renderFinding = (g: RuleGroupLite, muted: boolean) => (
    <FindingRow
      key={g.ruleId}
      group={g}
      runId={runId}
      pageIdToUrl={pageIdToUrl}
      automation={automationByRule.get(g.ruleId) ?? null}
      finding={findingsByRule.get(g.ruleId) ?? null}
      fixPlanItems={fixPlanByRule.get(g.ruleId) ?? []}
      fixPlanAvailable={fixPlan !== null}
      muted={muted}
      mutePending={isPending(g.ruleId)}
      onMuteToggle={(ruleId) => (isMuted(ruleId) ? unmute(ruleId) : mute(ruleId, "accepted from /issues"))}
      onOpenFixPlan={setFixPlanRuleId}
    />
  );

  const sinceSummary = useMemo(() => {
    const summary = { new: 0, worsened: 0, improved: 0, resolved: 0, unchanged: 0 };
    for (const row of sinceRows) {
      if (row.status === "new") summary.new++;
      else if (row.status === "worsened") summary.worsened++;
      else if (row.status === "improved") summary.improved++;
      else if (row.status === "resolved") summary.resolved++;
      else summary.unchanged++;
    }
    return summary;
  }, [sinceRows]);

  return (
    <div className="space-y-6">
      <KpiTiles items={kpiTiles} />

      {rulesSkippedDataUnavailable.length > 0 && (
        <p className="text-xs text-faint">
          {rulesSkippedDataUnavailable.length} rule{rulesSkippedDataUnavailable.length === 1 ? "" : "s"} skipped — data not captured in
          this run: {rulesSkippedDataUnavailable.join(", ")}
        </p>
      )}

      <IssuesToolbar
        group={group}
        onGroup={(g) => updateParams({ view: g === "area" ? null : g })}
        show={show}
        onShow={(v) => updateParams({ show: v === "failing" ? null : v })}
        severity={activeSeverity}
        onSeverity={(v) => updateParams({ severity: v })}
        automation={activeAutomation}
        onAutomation={(v) => updateParams({ fixType: v })}
        automationOptions={automationOptions}
        filtersActive={filtersActive}
        onClear={clearAll}
        q={qInput}
        onQChange={handleQChange}
        autoFixablePages={autoFixable}
        planOpen={planOpen}
        onTogglePlan={() => setPlanOpen((v) => !v)}
        onExportCsv={exportCsv}
      />

      {planOpen && group !== "since" &&
        (fixPlan ? (
          <FullFixPlan plan={fixPlan} runId={runId} onClose={() => setPlanOpen(false)} />
        ) : (
          <div className="rounded-card border border-dashed border-border-strong bg-card px-5 py-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">Fix plan</h3>
              <Button size="sm" variant="outline" onClick={() => setPlanOpen(false)}>
                Close
              </Button>
            </div>
            <p className="mt-2 text-xs text-secondary">
              Fix plan not generated for this run yet — run{" "}
              <code className="rounded border border-border bg-elevated px-1 py-0.5 text-[11px]">npm run fixplan -- --run {runId}</code>{" "}
              from <code className="rounded border border-border bg-elevated px-1 py-0.5 text-[11px]">seo-crawler-poc</code>.
            </p>
          </div>
        ))}

      {group === "since" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <SectionHeading
              title="Since the last crawl"
              sub="comparing this run with the previous judged crawl of the site"
            />
            {previousRuleCounts !== null && (
              <span className="ml-auto flex flex-wrap items-center gap-1.5">
                <span className="rounded-pill bg-subtle px-2 py-0.5 text-[11px] font-medium tabular-nums text-secondary">
                  net {sinceRows.reduce((s, r) => s + r.delta, 0) > 0 ? "+" : ""}
                  {sinceRows.reduce((s, r) => s + r.delta, 0)} findings
                </span>
                <span className="rounded-pill bg-danger-bg px-2 py-0.5 text-[11px] font-medium tabular-nums text-danger">{sinceSummary.new} new</span>
                <span className="rounded-pill bg-danger-bg px-2 py-0.5 text-[11px] font-medium tabular-nums text-danger">{sinceSummary.worsened} worse</span>
                <span className="rounded-pill bg-ok-bg px-2 py-0.5 text-[11px] font-medium tabular-nums text-ok">{sinceSummary.improved} improved</span>
                <span className="rounded-pill bg-ok-bg px-2 py-0.5 text-[11px] font-medium tabular-nums text-ok">{sinceSummary.resolved} resolved</span>
                <span className="rounded-pill bg-subtle px-2 py-0.5 text-[11px] font-medium tabular-nums text-secondary">{sinceSummary.unchanged} unchanged</span>
              </span>
            )}
          </div>
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
                    <Td className="capitalize normal-case">{row.severity === "error" ? "critical" : row.severity}</Td>
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
        </>
      )}

      {group === "worst" &&
        (worstMode === "clean" ? (
          cleanPageEntries.length === 0 ? (
            <EmptyState icon={FileWarning} title="No clean pages" description="Every page in this run has at least one unfixed issue." />
          ) : (
            <>
              <SectionHeading title="Clean pages" sub="no unfixed issues on these pages" />
              <TableContainer>
                <TableHead>
                  <Th>Page</Th>
                  <Th>Issues</Th>
                </TableHead>
                <tbody>
                  {cleanPageEntries.map(([pageId, url]) => (
                    <Tr key={pageId}>
                      <Td className="max-w-md truncate normal-case">
                        <a href={`/pages/${pageId}?run=${encodeURIComponent(runId)}`} className="text-primary underline underline-offset-2">
                          {url}
                        </a>
                      </Td>
                      <Td className="tabular-nums text-ok">0</Td>
                    </Tr>
                  ))}
                </tbody>
              </TableContainer>
            </>
          )
        ) : worstPages.length === 0 ? (
          <EmptyState icon={FileWarning} title="Worst-page ranking not available" description="This run predates the priority engine — reanalyze it to get a real per-page harm ranking." />
        ) : (
          <>
            <SectionHeading title="Worst pages" sub="the same findings, asked page-first" />
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
          </>
        ))}

      {group === "priority" &&
        (priorityRanked.length === 0 ? (
          <EmptyState icon={FileWarning} title="Nothing matches these filters" description="Try clearing search, severity, or fix type." />
        ) : (
          <>
            <SectionHeading title="Ranked by priority" sub="what to fix first on this site" />
            <div className="space-y-2">{priorityRanked.map((g) => renderFinding(g, false))}</div>
          </>
        ))}

      {group === "area" &&
        (areaGroups.length === 0 ? (
          <EmptyState icon={FileWarning} title="Nothing matches these filters" description="Try widening the severity or fix-type filter." />
        ) : (
          <>
            <SectionHeading title="By area" sub="grouped by the rulebook&apos;s areas, worst first inside each" />
            <div className="flex flex-col gap-4 md:flex-row">
              <GroupNav names={areaGroups.map((a) => a.category)} counts={navCounts} />
              <div className="min-w-0 flex-1 space-y-3">
                {areaGroups.map((a) => (
                  <GroupSection
                    key={a.category}
                    name={a.category}
                    list={a.groups}
                    runId={runId}
                    pageIdToUrl={pageIdToUrl}
                    automationByRule={automationByRule}
                    findingsByRule={findingsByRule}
                    fixPlanByRule={fixPlanByRule}
                    fixPlanAvailable={fixPlan !== null}
                    mutePending={isPending}
                    onMuteToggle={(ruleId) => (isMuted(ruleId) ? unmute(ruleId) : mute(ruleId, "accepted from /issues"))}
                    onOpenFixPlan={setFixPlanRuleId}
                    defaultOpen={a.groups.some((g) => g.items.length > 0)}
                  />
                ))}
              </div>
            </div>
          </>
        ))}

      <section className="overflow-hidden rounded-card border border-dashed border-border-strong bg-card">
        <button
          type="button"
          onClick={() => setShowAccepted((v) => !v)}
          aria-expanded={showAccepted}
          className="flex w-full cursor-pointer items-center gap-2.5 px-5 py-3 text-left text-sm font-medium text-foreground outline-none transition-colors duration-100 hover:bg-subtle focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ChevronRight size={14} strokeWidth={2} className={`text-faint transition-transform duration-150 ${showAccepted ? "rotate-90" : ""}`} aria-hidden="true" />
          <ShieldCheck size={15} strokeWidth={1.75} className="text-faint" aria-hidden="true" />
          Accepted risk
          <Badge tone="neutral">{acceptedGroups.reduce((n, g) => n + g.items.length, 0)}</Badge>
        </button>
        {showAccepted && (
          <div className="space-y-2 border-t border-border p-4">
            {acceptedGroups.length === 0 ? (
              <p className="text-sm text-faint">Nothing accepted yet — findings never disappear, they move here when muted.</p>
            ) : (
              acceptedGroups.map((g) => renderFinding(g, true))
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
