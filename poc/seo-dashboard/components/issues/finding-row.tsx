"use client";

import Link from "next/link";
import { CircleAlert, Info, ShieldOff, TriangleAlert, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HintTip } from "./hint-tip";
import { AutomationBadge } from "./finding-badges";
import { cn } from "@/lib/cn";
import type { RuleGroupLite } from "@/lib/issues-view-helpers";
import type { RuleAutomationSummary, FixPlanItem } from "@/lib/data-issue-extras";
import type { FindingReport } from "@/lib/types";

/** Display name for a rule id ("title-too-long" → "Title too long"). */
export function humanizeRuleId(ruleId: string): string {
  return ruleId
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

const SEV_LABEL: Record<string, string> = { error: "Critical", warning: "Warning", notice: "Notice" };

function SevIcon({ severity }: { severity: string }) {
  const cls = "h-3 w-3 shrink-0";
  if (severity === "error") return <CircleAlert className={cls} aria-hidden="true" />;
  if (severity === "warning") return <TriangleAlert className={cls} aria-hidden="true" />;
  return <Info className={cls} aria-hidden="true" />;
}

/** Severity reads through an OUTLINE badge — tinted text on a hairline border, the reference
 *  design's "⚠ WARNING / ⓘ NOTICE / ① CRITICAL" pill — plus a thin left accent on the card. */
const SEV_BADGE: Record<string, string> = {
  error: "border-danger/30 bg-danger-bg/50 text-danger",
  warning: "border-warn/30 bg-warn-bg/50 text-warn",
  notice: "border-data-blue/30 bg-data-blue/10 text-data-blue",
};

/** Left accent + reach-bar + meta-label colour per severity. */
const SEV_ACCENT: Record<string, string> = {
  error: "var(--color-danger)",
  warning: "var(--color-warn)",
  notice: "var(--color-data-blue)",
};
const SEV_BAR: Record<string, string> = {
  error: "bg-danger",
  warning: "bg-warn",
  notice: "bg-data-blue",
};
const SEV_META: Record<string, string> = {
  error: "text-danger/80",
  warning: "text-warn/80",
  notice: "text-data-blue",
};

/** Effort reads as a word with three bars — never as colour alone — and it is deliberately
 *  quieter than the severity badge: it is context for the priority, not a verdict of its own. */
function EffortChip({ level, why }: { level: "low" | "medium" | "high"; why: string }) {
  const on = level === "low" ? 1 : level === "medium" ? 2 : 3;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-subtle px-2 py-0.5 text-[11px] font-medium text-secondary"
      title={why}
    >
      <span className="flex items-end gap-0.5" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <i key={i} className={cn("h-1.5 w-1 rounded-[1px]", i < on ? "bg-foreground/60" : "bg-border")} />
        ))}
      </span>
      {level} effort
    </span>
  );
}

/** Priority formula hint — same factors the crawler's priority.ts multiplies. */
function priorityHint(f: FindingReport | null): { title: string; body: string; rows: [string, string][] } {
  const rows: [string, string][] = [["Formula", "severity × reach × importance × confidence"]];
  if (f?.priorityFactors) {
    const p = f.priorityFactors;
    rows.push(
      ["severity", `${Math.round(p.severity * 100)}%`],
      ["reach", `${Math.round(p.reach * 100)}% — share of the site affected`],
      ["importance", `${Math.round(p.importance * 100)}% — depth and inbound links`],
      ["confidence", `${Math.round(p.confidence * 100)}%`],
    );
  }
  return {
    title: "Priority",
    body: "What to fix **first on this site** — not how bad the fault is in the abstract. A critical fault on one buried page is rarely the first job; a notice on every page often is. Four factors, each between 0 and 1, multiplied together and shown as a score out of 100.",
    rows,
  };
}

function effortHint(e: { level: "low" | "medium" | "high"; why: string }): { title: string; body: string; rows: [string, string][] } {
  return {
    title: "Effort",
    body: "The other axis to priority — the fastest way to raise a health score is usually a cheap fix that touches every page. Derived from the automation level and how much of the site is affected, never hand-assigned per rule.",
    rows: [
      ["low", "scriptable, or a quick review on a few pages"],
      ["medium", "one decision applied widely, or a few judgment calls"],
      ["high", "a judgment call repeated across many pages"],
      ["this finding", e.why],
    ],
  };
}

const AUTOMATION_HINT: { title: string; body: string; rows: [string, string][] } = {
  title: "Automation level",
  body: "Whether a machine may apply the fix without a human deciding. Three questions, and **all three** must pass before anything is automatic:\n\n**1.** Is the correct value derivable without judgment?\n\n**2.** Is the change reversible?\n\n**3.** Is the blast radius one page, or the whole template?",
  rows: [
    ["⚡ auto-safe", "Apply it. Value is computable, change is reversible."],
    ["◐ needs review", "Generate the change; a human approves before it ships."],
    ["✋ human only", "Needs judgment, or is too dangerous to get wrong."],
  ],
};

const CONFIDENCE_HINT: { title: string; body: string; rows?: [string, string][] } = {
  title: "Confidence",
  body: "How much to trust the finding — derived from **how it was detected**, not assigned by hand.\n\n**Observed (100%)** — read straight off the page.\n\n**Derived (90%)** — needs crawl-wide knowledge, so it is only as complete as the crawl.\n\n**Heuristic (70%)** — a threshold or pattern that can legitimately be wrong.",
};

// How many affected URLs an opened finding lists before it defers to the export.
const PAGES_SHOWN = 50;

function formatEvidenceValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return value.length === 0 ? "[]" : value.map((v) => formatEvidenceValue(v)).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

interface Props {
  group: RuleGroupLite;
  runId: string;
  pageIdToUrl: Map<string, string>;
  automation: RuleAutomationSummary | null;
  finding: FindingReport | null;
  fixPlanItems: FixPlanItem[];
  fixPlanAvailable: boolean;
  muted: boolean;
  mutePending?: boolean;
  onMuteToggle: (ruleId: string) => void;
  onOpenFixPlan: (ruleId: string) => void;
}

function MetaLabel({ children, tone }: { children: string; tone: string }) {
  return <span className={cn("text-[10px] font-semibold uppercase tracking-widest", tone)}>{children}</span>;
}

/** One rule as a COMPACT ROW that opens. Collapsed carries what you scan by — severity, what it
 *  is, how much of the site it touches, priority. Expanded carries the rest: confidence, the
 *  priority factors, the evidence observed, why it matters, the fix, and the affected pages. */
export function FindingRow({
  group,
  runId,
  pageIdToUrl,
  automation,
  finding,
  fixPlanItems,
  fixPlanAvailable,
  muted,
  mutePending,
  onMuteToggle,
  onOpenFixPlan,
}: Props) {
  const sevBadge = SEV_BADGE[group.severity] ?? SEV_BADGE.notice;
  const sevBar = SEV_BAR[group.severity] ?? SEV_BAR.notice;
  const sevMeta = SEV_META[group.severity] ?? SEV_META.notice;
  const share = group.affectedPercent;
  const count = group.items.length;
  const title = humanizeRuleId(group.ruleId);
  const effort = automation?.effort ?? (finding ? { level: finding.effort, why: finding.effortWhy } : null);
  const confidence = finding?.confidence ?? automation?.confidence ?? null;
  const detection = finding?.detectionTier ?? null;
  const why = finding?.why ?? group.items[0]?.message ?? "";
  const fix = finding?.howToFix ?? group.items[0]?.howToFix ?? "";
  const firstIssue = group.items[0];
  const evidenceText = firstIssue
    ? firstIssue.evidence.length > 0
      ? firstIssue.evidence
          .slice(0, 2)
          .map((e) => `${e.field} = ${formatEvidenceValue(e.value)}`)
          .join(" · ")
      : firstIssue.message
    : null;
  const hasBody = Boolean(evidenceText || why || fix);
  const accent = muted ? undefined : SEV_ACCENT[group.severity];

  return (
    <details
      data-finding-rule={group.ruleId}
      className={cn(
        "group cursor-pointer rounded-card bg-card transition-colors duration-150 open:cursor-default",
        muted
          ? "border border-dashed border-border-strong opacity-75"
          : "border border-border hover:border-border-strong",
      )}
      style={accent ? { borderLeftColor: accent, borderLeftWidth: 3 } : undefined}
      open={group.severity === "error" && count <= 3}
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
        <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-pill border px-2.5 py-1 text-[11px] font-semibold", sevBadge)}>
          <SevIcon severity={group.severity} />
          {SEV_LABEL[group.severity] ?? group.severity}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">{title}</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-secondary">
            <span className="truncate">{group.category}</span>
            {firstIssue?.scope === "site" && (
              <span className="shrink-0 rounded-pill bg-subtle px-1.5 py-px font-medium text-faint">whole site</span>
            )}
          </span>
        </span>

        <span className="flex shrink-0 flex-wrap items-center gap-1.5">
          <AutomationBadge level={automation?.automation ?? null} />
          {effort && <EffortChip level={effort.level} why={effort.why} />}
        </span>

        <span className="flex w-28 shrink-0 flex-col items-end gap-1">
          {firstIssue?.scope === "site" ? (
            <span className="rounded-pill bg-subtle px-2 py-0.5 text-[11px] text-faint">whole site</span>
          ) : (
            <>
              <span className="h-1.5 w-full overflow-hidden rounded-full bg-border" aria-hidden="true">
                <i className={cn("block h-full rounded-full", sevBar)} style={{ width: `${Math.max(3, share)}%` }} />
              </span>
              <span className="text-[11px] tabular-nums text-faint">
                {count} {count === 1 ? "page" : "pages"}
              </span>
            </>
          )}
        </span>

        <span className="flex w-14 shrink-0 flex-col items-end">
          <span className="text-lg font-bold leading-none tabular-nums text-foreground">{finding ? finding.priority : "—"}</span>
          <span className="mt-1 text-[9px] font-semibold uppercase tracking-widest text-faint">{muted ? "accepted" : "priority"}</span>
        </span>

        <span className="shrink-0 text-faint transition-transform duration-150 group-open:rotate-90" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 3.5 10.5 8 6 12.5" />
          </svg>
        </span>
      </summary>

      <div className="border-t border-border px-4 py-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {confidence !== null && (
            <span className="inline-flex items-center gap-1 rounded-pill border border-border bg-subtle px-2 py-0.5 text-[11px] font-medium text-secondary">
              <span className="tabular-nums">{Math.round(confidence * 100)}%</span>
              {detection ?? "confidence"}
            </span>
          )}
          <HintTip {...priorityHint(finding)}>priority {finding?.priority ?? "—"} ⓘ</HintTip>
          {effort && <HintTip {...effortHint(effort)}>effort {effort.level} ⓘ</HintTip>}
          <HintTip {...AUTOMATION_HINT}>automation ⓘ</HintTip>
          <HintTip {...CONFIDENCE_HINT}>confidence ⓘ</HintTip>
          {fixPlanAvailable && fixPlanItems.length > 0 && (
            <Button size="sm" variant="outline" onClick={(e) => { e.preventDefault(); onOpenFixPlan(group.ruleId); }}>
              <Wrench size={12} strokeWidth={2} aria-hidden="true" />
              Fix plan ({fixPlanItems.length})
            </Button>
          )}
          <Button
            size="sm"
            variant={muted ? "outline" : "ghost"}
            disabled={mutePending}
            className="ml-auto"
            onClick={(e) => {
              e.preventDefault();
              onMuteToggle(group.ruleId);
            }}
          >
            <ShieldOff size={12} strokeWidth={2} aria-hidden="true" />
            {mutePending ? "Recomputing…" : muted ? "Un-accept — count it again" : "Accept this risk"}
          </Button>
        </div>

        {muted && finding?.mutedAt && (
          <p className="mt-2.5 rounded-control bg-subtle px-2.5 py-1.5 text-[11px] text-faint">
            Accepted on {new Date(finding.mutedAt).toLocaleDateString()} — still detected and still listed, but not counted in
            the score or the totals.
            {finding.mutedNote ? ` “${finding.mutedNote}”` : ""}
          </p>
        )}

        {hasBody && (
          <div className="mt-3.5 space-y-3.5 rounded-control border border-border bg-subtle p-3.5">
            {evidenceText && (
              <div>
                <MetaLabel tone={sevMeta}>Found</MetaLabel>
                <code className="mt-1 block overflow-x-auto whitespace-pre-wrap rounded-control border border-border bg-elevated px-2.5 py-2 text-xs leading-relaxed text-secondary">
                  {evidenceText}
                </code>
              </div>
            )}
            {why && (
              <div>
                <MetaLabel tone={sevMeta}>Why</MetaLabel>
                <p className="mt-1 text-xs leading-relaxed text-secondary">{why}</p>
              </div>
            )}
            {fix && (
              <div>
                <MetaLabel tone={sevMeta}>Fix</MetaLabel>
                <p className="mt-1 text-xs leading-relaxed text-secondary">{fix}</p>
              </div>
            )}
          </div>
        )}

        {count > 0 && (
          <div className="mt-3.5">
            <div className="flex items-center justify-between gap-2">
              <MetaLabel tone={sevMeta}>Pages</MetaLabel>
              {/* Rule-level drill-down: see every page behind this finding in one view. Hidden
                  when already filtered to this rule (the whole page would just re-show itself). */}
              {!muted && (
                <Link
                  href={`/issues?run=${encodeURIComponent(runId)}&rule=${encodeURIComponent(group.ruleId)}`}
                  className="text-[11px] font-medium text-primary underline underline-offset-2 hover:opacity-80"
                >
                  View all {group.affectedPageCount.toLocaleString()} {group.affectedPageCount === 1 ? "page" : "pages"} for this rule →
                </Link>
              )}
            </div>
            <ul className="mt-1.5 space-y-1.5">
              {group.items.slice(0, PAGES_SHOWN).map((issue, i) => {
                const pageId = issue.pageId;
                const linked = Boolean(pageId && pageIdToUrl.has(pageId));
                return (
                  <li
                    key={`${issue.ruleId}-${i}`}
                    className="rounded-control border border-border bg-subtle px-2.5 py-1.5 transition-colors duration-100 hover:border-border-strong hover:bg-elevated"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                      {pageId && linked ? (
                        <Link
                          href={`/pages/${pageId}?run=${encodeURIComponent(runId)}`}
                          className="truncate text-xs text-primary underline underline-offset-2"
                        >
                          {pageIdToUrl.get(pageId) ?? issue.url}
                        </Link>
                      ) : (
                        <span className="truncate text-xs text-secondary">{issue.url ?? "(site-wide)"}</span>
                      )}
                      {issue.evidence.length > 0 && (
                        <span className="shrink-0 truncate text-[10px] tabular-nums text-faint">
                          {issue.evidence.slice(0, 1).map((e) => `${e.field} = ${formatEvidenceValue(e.value)}`).join("")}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
              {group.affectedPageCount > Math.min(count, PAGES_SHOWN) && (
                <li className="px-1 text-[11px] text-faint">
                  Showing {Math.min(count, PAGES_SHOWN)} of {group.affectedPageCount.toLocaleString()} — all of them are in the
                  CSV export.
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}
