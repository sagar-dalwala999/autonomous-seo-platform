import Link from "next/link";
import { History } from "lucide-react";
import { listRuns, getPages, type RunListItem } from "@/lib/data";
import { EmptyState } from "@/components/ui/empty-state";
import { TableContainer, TableHead, Th, Tr, Td } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CoverageBar } from "@/components/overview/coverage-bar";

function formatDuration(startedAt: string, finishedAt: string): string {
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

async function maxDepthFor(runId: string): Promise<number | null> {
  const { items } = await getPages(runId, {});
  const depths = items.map((p) => p.crawl.depth).filter((d): d is number => d !== null);
  return depths.length > 0 ? Math.max(...depths) : null;
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

  const maxDepths = await Promise.all(runs.map((r) => maxDepthFor(r.runId)));

  return (
    <TableContainer>
      <TableHead>
        <Th>Run</Th>
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
        {runs.map((run: RunListItem, i: number) => {
          const href = `/?run=${encodeURIComponent(run.runId)}`;
          const maxDepth = maxDepths[i];
          return (
            <Tr key={run.runId}>
              <Td className="font-medium text-foreground">
                <Link href={href} className="text-primary underline underline-offset-2">
                  {run.runId}
                </Link>
              </Td>
              <Td className="max-w-xs">
                <Link href={href} className="block truncate text-secondary hover:text-foreground hover:underline">
                  {run.startUrl}
                </Link>
              </Td>
              <Td className="text-secondary">
                <Link href={href} className="hover:text-foreground hover:underline">
                  {new Date(run.startedAt).toLocaleString()}
                </Link>
              </Td>
              <Td>
                <Link href={href} className="hover:text-foreground hover:underline">
                  {formatDuration(run.startedAt, run.finishedAt)}
                </Link>
              </Td>
              <Td>
                <Link href={href} className="hover:text-foreground hover:underline">
                  {maxDepth ?? <span className="text-faint">—</span>}
                </Link>
              </Td>
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
            </Tr>
          );
        })}
      </tbody>
    </TableContainer>
  );
}
