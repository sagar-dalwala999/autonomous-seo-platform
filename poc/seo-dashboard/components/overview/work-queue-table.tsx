import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import type { WorkQueueRow } from "@/lib/data-overview";
import { issueLabel } from "@/lib/data-overview";
import { TableContainer, TableHead, Th, Tr, Td } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";

const AVATAR_TONES = ["bg-data-blue/15 text-data-blue", "bg-data-violet/15 text-data-violet", "bg-data-orange/15 text-data-orange", "bg-data-green/15 text-data-green"];

function toneFor(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) hash = (hash * 31 + url.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

function letterFor(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/^\/+/, "");
    return (path[0] || "/").toUpperCase();
  } catch {
    return "?";
  }
}

function issueTone(issue: WorkQueueRow["issues"][number]): "danger" | "warn" {
  return issue === "http-5xx" || issue === "redirect-loop" ? "danger" : "warn";
}

export function WorkQueueTable({ rows, runId }: { rows: WorkQueueRow[]; runId: string }) {
  if (rows.length === 0) {
    return (
      <EmptyState icon={ClipboardCheck} title="Nothing needs you right now" description="No 4xx/5xx pages, redirect loops, noindex-on-crawlable pages, or orphan candidates in this run." />
    );
  }

  return (
    <TableContainer>
      <TableHead>
        <Th>Page</Th>
        <Th>Issue</Th>
        <Th>Depth</Th>
        <Th>Response</Th>
        <Th>Status</Th>
        <Th>&nbsp;</Th>
      </TableHead>
      <tbody>
        {rows.map((row) => {
          const evidenceHref = row.pageId
            ? `/pages/${row.pageId}?run=${encodeURIComponent(runId)}`
            : `/failures?run=${encodeURIComponent(runId)}`;
          return (
          <Tr key={row.key}>
            <Td className="max-w-sm">
              <div className="flex items-center gap-2.5">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-xs font-semibold ${toneFor(row.url)}`} aria-hidden="true">
                  {letterFor(row.url)}
                </span>
                <Link href={evidenceHref} className="truncate text-secondary underline-offset-2 hover:text-foreground hover:underline">
                  {row.url}
                </Link>
              </div>
            </Td>
            <Td>
              <div className="flex flex-wrap gap-1">
                {row.issues.map((issue) => (
                  <Badge key={issue} tone={issueTone(issue)}>
                    {issueLabel(issue)}
                  </Badge>
                ))}
              </div>
            </Td>
            <Td>{row.depth ?? <span className="text-faint">—</span>}</Td>
            <Td>{row.responseTimeMs !== null ? `${row.responseTimeMs}ms` : <span className="text-faint">—</span>}</Td>
            <Td>
              {row.statusCode === null ? <span className="text-faint">—</span> : <Badge tone={row.statusCode >= 500 ? "danger" : row.statusCode >= 400 ? "danger" : "warn"}>{row.statusCode}</Badge>}
            </Td>
            <Td>
              <Link href={evidenceHref} className="whitespace-nowrap text-xs font-medium text-primary underline underline-offset-2">
                View evidence
              </Link>
            </Td>
          </Tr>
          );
        })}
      </tbody>
    </TableContainer>
  );
}
