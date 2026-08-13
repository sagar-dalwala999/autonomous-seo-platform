import Link from "next/link";
import { History } from "lucide-react";
import { listRuns, type RunListItem } from "@/lib/data";
import { EmptyState } from "@/components/ui/empty-state";
import { TableContainer, TableHead, Th, Tr, Td } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CoverageBar } from "@/components/overview/coverage-bar";
import { hostnameFor, formatRunTimestamp } from "@/components/shell/run-label";

function formatDuration(startedAt: string, finishedAt: string): string {
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default async function RunsPage() {
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
      </TableHead>
      <tbody>
        {runs.map((run: RunListItem) => {
          const href = `/?run=${encodeURIComponent(run.runId)}`;
          return (
            <Tr key={run.runId}>
              <Td className="font-medium text-foreground">
                <Link href={href} className="block underline-offset-2 hover:underline" title={run.runId}>
                  <span className="block text-primary">{hostnameFor(run.startUrl)}</span>
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
            </Tr>
          );
        })}
      </tbody>
    </TableContainer>
  );
}
