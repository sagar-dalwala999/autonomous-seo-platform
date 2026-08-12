import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SeverityBadge } from "./severity-badge";
import type { IssueRuleGroup } from "@/lib/data-issues";

interface Props {
  group: IssueRuleGroup;
  runId: string;
  pageIdToUrl: Map<string, string>;
  resolvePageId: (url: string) => string | null;
}

/** One rule group: severity + category + coverage in the summary row, expand → every affected
 *  URL (each linking to its page detail, or a "never crawled" badge when no page record exists —
 *  same idiom as app/failures/page.tsx and app/sitemap/page.tsx). */
export function RuleGroupCard({ group, runId, pageIdToUrl, resolvePageId }: Props) {
  return (
    <details className="group rounded-card border border-border bg-card" open={group.severity === "error" && group.items.length <= 3}>
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
        <span className="ml-auto shrink-0 tabular-nums text-xs text-faint">
          {group.affectedPageCount} affected · {group.affectedPercent}% of analyzed pages
        </span>
      </summary>
      <div className="border-t border-border p-4">
        <p className="mb-3 text-xs text-secondary">{group.howToFix}</p>
        <ul className="space-y-2 text-sm">
          {group.items.map((issue, i) => {
            const pageId = issue.pageId ?? (issue.url ? resolvePageId(issue.url) : null);
            const extraPageIds = [
              ...new Set(issue.evidence.map((e) => e.pageId).filter((id): id is string => Boolean(id) && id !== issue.pageId)),
            ];
            return (
              <li key={`${issue.ruleId}-${i}`} className="rounded-control border border-border bg-subtle px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {pageId ? (
                    <Link
                      href={`/pages/${pageId}?run=${encodeURIComponent(runId)}`}
                      className="truncate text-primary underline underline-offset-2"
                    >
                      {pageIdToUrl.get(pageId) ?? issue.url}
                    </Link>
                  ) : (
                    <span className="truncate text-secondary">{issue.url ?? "(site-wide)"}</span>
                  )}
                  {!pageId && issue.url && (
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
