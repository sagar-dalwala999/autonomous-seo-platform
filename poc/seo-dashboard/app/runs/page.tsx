import Link from "next/link";
import { History, ShieldAlert, FileText, AlertTriangle, GitCompare } from "lucide-react";
import { listRuns, type RunListItem } from "@/lib/data";
import { EmptyState } from "@/components/ui/empty-state";
import { TableContainer, TableHead, Th, Tr, Td } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CoverageBar } from "@/components/overview/coverage-bar";
import { hostnameFor, formatRunTimestamp } from "@/components/shell/run-label";
import { cn } from "@/lib/cn";

function formatDuration(startedAt: string, finishedAt: string): string {
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

interface Props {
  searchParams: Promise<{ run?: string }>;
}

/** Per-run quick links — one click from the hub to the run's issues, failures, pages, or a diff
 *  against the previous run. Icon-only, title-labelled (the table already reads dense; adding a
 *  text column per link would push the coverage bar out of sight). */
function RunQuickLinks({ run, previousRunId }: { run: RunListItem; previousRunId: string | null }) {
  const q = `?run=${encodeURIComponent(run.runId)}`;
  const links: { href: string; label: string; icon: React.ReactNode }[] = [
    { href: `/issues${q}`, label: "Issues", icon: <ShieldAlert size={13} strokeWidth={1.75} aria-hidden="true" /> },
    { href: `/sitemap${q}#failures`, label: "Failures & blocked", icon: <AlertTriangle size={13} strokeWidth={1.75} aria-hidden="true" /> },
    { href: `/pages${q}`, label: "Pages", icon: <FileText size={13} strokeWidth={1.75} aria-hidden="true" /> },
  ];
  if (previousRunId) {
    links.push({
      href: `/compare?base=${encodeURIComponent(previousRunId)}&head=${encodeURIComponent(run.runId)}`,
      label: "Compare with previous",
      icon: <GitCompare size={13} strokeWidth={1.75} aria-hidden="true" />,
    });
  }
  return (
    <div className="flex items-center justify-end gap-0.5">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          title={l.label}
          aria-label={l.label}
          className="flex h-7 w-7 items-center justify-center rounded-control text-faint outline-none transition-colors duration-150 hover:bg-subtle hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        >
          {l.icon}
        </Link>
      ))}
    </div>
  );
}

export default async function RunsPage({ searchParams }: Props) {
  const { run: highlightRunId } = await searchParams;
  const runs = await listRuns();

  if (runs.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No runs recorded yet"
        description="Each run of the crawler writes storage/runs/<runId>/report.json — this list reads that directly."
        action={
          <pre className="overflow-x-auto rounded-control border border-border bg-elevated px-3 py-2 text-left text-xs text-secondary">
            npm run crawl -- https://example.com
          </pre>
        }
      />
    );
  }

  return (
    <TableContainer>
      <TableHead>
        <Th>Site</Th>
        <Th>Start URL</Th>
        <Th>Started</Th>
        <Th>Duration</Th>
        <Th>Depth</Th>
        <Th>Coverage</Th>
        <Th>Pages</Th>
        <Th>Failed</Th>
        <Th>Blocked</Th>
        <Th className="text-right">Actions</Th>
      </TableHead>
      <tbody>
        {runs.map((run: RunListItem, index: number) => {
          const href = `/?run=${encodeURIComponent(run.runId)}`;
          // listRuns is startedAt desc, so the previous run is the next index.
          const previousRunId = index + 1 < runs.length ? runs[index + 1].runId : null;
          const highlighted = highlightRunId === run.runId;
          return (
            <Tr key={run.runId} className={cn(highlighted && "bg-primary/5")}>
              <Td className="font-medium text-foreground">
                <Link href={href} className="block underline-offset-2 hover:underline" title={run.runId}>
                  <span className="flex items-center gap-1.5 text-primary">
                    {hostnameFor(run.startUrl)}
                    {run.analyzed && run.healthScore !== null && run.healthScore !== undefined && (
                      <span className="rounded-pill bg-subtle px-1.5 text-[10px] font-medium text-secondary" title="Health score">
                        {run.healthScore}
                      </span>
                    )}
                  </span>
                  <span className="block text-[11px] font-normal text-faint">{run.runId}</span>
                </Link>
              </Td>
              <Td className="max-w-xs">
                <Link href={href} className="block truncate text-secondary hover:text-foreground hover:underline">
                  {run.startUrl}
                </Link>
              </Td>
              <Td className="text-secondary">
                <Link href={href} className="hover:text-foreground hover:underline">
                  {formatRunTimestamp(run.startedAt)}
                </Link>
              </Td>
              <Td>
                <Link href={href} className="hover:text-foreground hover:underline">
                  {formatDuration(run.startedAt, run.finishedAt)}
                </Link>
              </Td>
              <Td>
                <Link href={href} className="hover:text-foreground hover:underline">
                  {run.maxDepthSeen ?? <span className="text-faint" title="Run predates depth tracking">—</span>}
                </Link>
              </Td>
              {run.state === "cancelled" ? (
                <>
                  <Td>
                    <Link href={href} className="inline-flex hover:opacity-80">
                      <Badge tone="neutral">Cancelled</Badge>
                    </Link>
                  </Td>
                  <Td className="text-faint">
                    <Link href={href} className="hover:text-foreground hover:underline">
                      stopped before finishing
                    </Link>
                  </Td>
                  <Td>
                    <Link href={href} className="inline-block hover:opacity-80">
                      <Badge tone="ok">{run.successful}</Badge>
                    </Link>
                  </Td>
                  <Td className="text-faint">
                    <Link href={href} className="hover:text-foreground">
                      —
                    </Link>
                  </Td>
                </>
              ) : (
                <>
                  <Td>
                    <Link href={href} className="flex w-24 flex-col gap-1 hover:opacity-80">
                      <span className="text-secondary">{run.coveragePercent.toFixed(1)}%</span>
                      <CoverageBar percent={run.coveragePercent} />
                    </Link>
                  </Td>
                  <Td>
                    <Link href={href} className="inline-block hover:opacity-80">
                      <Badge tone="ok">{run.successful}</Badge>
                    </Link>
                  </Td>
                  <Td>
                    <Link href={href} className="inline-block hover:opacity-80">
                      {run.failed > 0 ? <Badge tone="danger">{run.failed}</Badge> : <span className="text-faint">0</span>}
                    </Link>
                  </Td>
                  <Td>
                    <Link href={href} className="inline-block hover:opacity-80">
                      {run.blockedByRobots > 0 ? <Badge tone="warn">{run.blockedByRobots}</Badge> : <span className="text-faint">0</span>}
                    </Link>
                  </Td>
                </>
              )}
              <Td>
                <RunQuickLinks run={run} previousRunId={previousRunId} />
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </TableContainer>
  );
}
