import Link from "next/link";
import { ChevronRight, ShieldOff, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SeverityBadge } from "./severity-badge";
import { AutomationBadge, EffortBadge, ConfidenceBadge } from "./finding-badges";
import type { RuleGroupLite } from "@/lib/issues-view-helpers";
import type { RuleAutomationSummary, FixPlanItem } from "@/lib/data-issue-extras";

interface Props {
  group: RuleGroupLite;
  runId: string;
  pageIdToUrl: Map<string, string>;
  automation: RuleAutomationSummary | null;
  fixPlanItems: FixPlanItem[];
  fixPlanAvailable: boolean;
  muted: boolean;
  mutePending?: boolean;
  onMuteToggle: (ruleId: string) => void;
  onOpenFixPlan: (ruleId: string) => void;
  defaultOpen?: boolean;
}

/** One rule group: severity + category + coverage + automation/effort/confidence in the summary
 *  row, expand → every affected URL, each linking to its page detail (or a "never crawled" badge
 *  when no page record exists — same idiom as app/failures/page.tsx and app/sitemap/page.tsx). */
export function RuleGroupCard({
  group,
  runId,
  pageIdToUrl,
  automation,
  fixPlanItems,
  fixPlanAvailable,
  muted,
  mutePending,
  onMuteToggle,
  onOpenFixPlan,
  defaultOpen,
}: Props) {
  return (
    <details
      className="group rounded-card border border-border bg-card"
      open={defaultOpen ?? (group.severity === "error" && group.items.length <= 3)}
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-5 py-3.5 outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
        <ChevronRight
          size={14}
          strokeWidth={2}
          className="shrink-0 text-faint transition-transform duration-150 group-open:rotate-90"
          aria-hidden="true"
        />
        <SeverityBadge severity={group.severity} />
        <span className="font-mono text-xs text-faint">{group.ruleId}</span>
        <Badge tone="neutral">{group.category}</Badge>
        <AutomationBadge level={automation?.automation ?? null} />
        <EffortBadge level={automation?.effort.level ?? null} />
        <ConfidenceBadge value={automation?.confidence ?? null} />
        {muted && <Badge tone="ok">Accepted</Badge>}
        <span className="ml-auto shrink-0 tabular-nums text-xs text-faint">
          {group.affectedPageCount} affected · {group.affectedPercent}% of analyzed pages
        </span>
      </summary>
      <div className="border-t border-border p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-secondary">{group.howToFix}</p>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.preventDefault();
                onOpenFixPlan(group.ruleId);
              }}
            >
              <Wrench size={12} strokeWidth={2} aria-hidden="true" />
              Fix plan{fixPlanAvailable ? ` (${fixPlanItems.length})` : ""}
            </Button>
            <Button
              size="sm"
              variant={muted ? "outline" : "ghost"}
              disabled={mutePending}
              onClick={(e) => {
                e.preventDefault();
                onMuteToggle(group.ruleId);
              }}
            >
              <ShieldOff size={12} strokeWidth={2} aria-hidden="true" />
              {mutePending ? "Recomputing…" : muted ? "Unaccept" : "Accept risk"}
            </Button>
          </div>
        </div>
        <ul className="space-y-2 text-sm">
          {group.items.map((issue, i) => {
            const pageId = issue.pageId;
            const extraPageIds = [
              ...new Set(issue.evidence.map((e) => e.pageId).filter((id): id is string => Boolean(id) && id !== issue.pageId)),
            ];
            return (
              <li key={`${issue.ruleId}-${i}`} className="rounded-control border border-border bg-subtle px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {pageId && pageIdToUrl.has(pageId) ? (
                    <Link
                      href={`/pages/${pageId}?run=${encodeURIComponent(runId)}`}
                      className="truncate text-primary underline underline-offset-2"
                    >
                      {pageIdToUrl.get(pageId) ?? issue.url}
                    </Link>
                  ) : (
                    <span className="truncate text-secondary">{issue.url ?? "(site-wide)"}</span>
                  )}
                  {!(pageId && pageIdToUrl.has(pageId)) && issue.url && (
                    <span className="shrink-0 whitespace-nowrap rounded-pill bg-subtle px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-faint">
                      never crawled
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-faint">{issue.message}</p>
                {extraPageIds.length > 0 && (
                  <p className="mt-1 flex flex-wrap gap-x-1.5 text-xs text-faint">
                    also on:
                    {extraPageIds.map((pid) => (
                      <Link
                        key={pid}
                        href={`/pages/${pid}?run=${encodeURIComponent(runId)}`}
                        className="text-primary underline underline-offset-2"
                      >
                        {pageIdToUrl.get(pid) ?? pid}
                      </Link>
                    ))}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </details>
  );
}
