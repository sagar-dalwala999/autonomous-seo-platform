import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronRight, History, ShieldAlert } from "lucide-react";
import { resolveRunId, getRun, getPages, readSkipped } from "@/lib/data";
import { groupFailuresByClass, findPageIdByUrl } from "@/lib/data-explorer";
import type { SkippedUrlRecord } from "@/lib/types";
import { EmptyState } from "@/components/ui/empty-state";
import { TableContainer, TableHead, Th, Tr, Td } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const SKIPPED_REASON_ORDER: SkippedUrlRecord["reason"][] = ["logout", "destructive", "user-excluded"];
const SKIPPED_REASON_LABEL: Record<SkippedUrlRecord["reason"], string> = {
  logout: "Logout links",
  destructive: "Destructive links",
  "user-excluded": "User-excluded patterns",
};

/** Local to this page (data-explorer.ts is owned by S10 — see its file header). */
function groupSkippedByReason(items: SkippedUrlRecord[]): { reason: SkippedUrlRecord["reason"]; items: SkippedUrlRecord[] }[] {
  const map = new Map<SkippedUrlRecord["reason"], SkippedUrlRecord[]>();
  for (const s of items) map.set(s.reason, [...(map.get(s.reason) ?? []), s]);
  return SKIPPED_REASON_ORDER.filter((r) => map.has(r)).map((reason) => ({ reason, items: map.get(reason)! }));
}

interface Props {
  searchParams: Promise<{ run?: string }>;
}

export default async function FailuresPage({ searchParams }: Props) {
  const { run } = await searchParams;
  const runId = await resolveRunId(run);

  if (!runId) {
    return <EmptyState icon={History} title="No crawl runs yet" description="Run a crawl to see failures and blocked URLs here." />;
  }

  const [{ failures, blocked, robots }, pages, skipped] = await Promise.all([
    getRun(runId),
    getPages(runId),
    readSkipped(runId),
  ]);
  const groups = groupFailuresByClass(failures);
  const skippedGroups = groupSkippedByReason(skipped);
  const q = `run=${encodeURIComponent(runId)}`;

  if (failures.length === 0 && blocked.length === 0 && skipped.length === 0) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title="Run is clean"
        description={`No failures, nothing blocked by robots.txt, and nothing skipped for safety in run ${runId}.`}
      />
    );
  }

  return (
    <div className="space-y-6">
      {groups.length === 0 ? (
        <p className="text-sm text-faint">No failures in this run.</p>
      ) : (
        groups.map((g) => (
          <details key={g.reason} className="group rounded-card border border-border bg-card" open={g.items.length <= 8}>
            <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3.5 text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
              <ChevronRight size={14} strokeWidth={2} className="shrink-0 text-faint transition-transform duration-150 group-open:rotate-90" aria-hidden="true" />
              {g.reason}
              <Badge tone="danger">{g.items.length}</Badge>
            </summary>
            <div className="border-t border-border">
              <TableContainer className="rounded-none border-0">
                <TableHead>
                  <Th>URL</Th>
                  <Th>Status</Th>
                  <Th>Depth</Th>
                  <Th>Attempts</Th>
                  <Th>Error</Th>
                  <Th>Parent</Th>
                  <Th>&nbsp;</Th>
                </TableHead>
                <tbody>
                  {g.items.map((f, i) => {
                    const pageId = findPageIdByUrl(pages, f.url);
                    return (
                      <Tr key={`${f.url}-${i}`}>
                        <Td className="max-w-xs truncate normal-case">
                          {pageId ? (
                            <Link href={`/pages/${pageId}?${q}`} className="text-primary underline underline-offset-2">
                              {f.url}
                            </Link>
                          ) : (
                            f.url
                          )}
                        </Td>
                        <Td>{f.statusCode ?? <span className="text-faint">—</span>}</Td>
                        <Td>{f.depth ?? <span className="text-faint">—</span>}</Td>
                        <Td>{f.attempts}</Td>
                        <Td className="max-w-xs truncate normal-case text-secondary">{f.error ?? <span className="text-faint">—</span>}</Td>
                        <Td className="max-w-[16ch] truncate normal-case text-secondary">{f.parentUrl ?? <span className="text-faint">—</span>}</Td>
                        <Td>
                          {pageId ? (
                            <Link href={`/pages/${pageId}?${q}`} className="whitespace-nowrap text-xs font-medium text-primary underline underline-offset-2">
                              View page
                            </Link>
                          ) : (
                            <span className="whitespace-nowrap text-xs text-faint">never crawled</span>
                          )}
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </TableContainer>
            </div>
          </details>
        ))
      )}

      <details className="group rounded-card border border-border bg-card" open={blocked.length > 0 && blocked.length <= 8}>
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-5 py-3.5 text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
          <ChevronRight size={14} strokeWidth={2} className="shrink-0 text-faint transition-transform duration-150 group-open:rotate-90" aria-hidden="true" />
          <AlertTriangle size={14} strokeWidth={1.75} className="text-warn" aria-hidden="true" />
          Blocked by robots.txt
          <Badge tone="warn">{blocked.length}</Badge>
        </summary>
        <div className="border-t border-border">
          {blocked.length === 0 ? (
            <p className="px-5 py-3 text-sm text-faint">Nothing was blocked by robots.txt in this run.</p>
          ) : (
            <TableContainer className="rounded-none border-0">
              <TableHead>
                <Th>Normalized URL</Th>
                <Th>&nbsp;</Th>
              </TableHead>
              <tbody>
                {blocked.map((url) => {
                  const pageId = findPageIdByUrl(pages, url);
                  return (
                    <Tr key={url}>
                      <Td className="max-w-md truncate normal-case">{url}</Td>
                      <Td>
                        {pageId ? (
                          <Link href={`/pages/${pageId}?${q}`} className="whitespace-nowrap text-xs font-medium text-primary underline underline-offset-2">
                            View page
                          </Link>
                        ) : (
                          <span className="whitespace-nowrap text-xs text-faint">never crawled</span>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </TableContainer>
          )}
        </div>
      </details>

      <section>
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <ShieldAlert size={14} strokeWidth={1.75} className="text-warn" aria-hidden="true" />
          Skipped for safety
        </h2>
        {skippedGroups.length === 0 ? (
          <p className="text-sm text-faint">No URLs were skipped in this run.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {skippedGroups.map((g) => (
              <details key={g.reason} className="group rounded-card border border-border bg-card" open={g.items.length <= 8}>
                <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3.5 text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
                  <ChevronRight
                    size={14}
                    strokeWidth={2}
                    className="shrink-0 text-faint transition-transform duration-150 group-open:rotate-90"
                    aria-hidden="true"
                  />
                  {SKIPPED_REASON_LABEL[g.reason]}
                  <Badge tone="warn">{g.items.length}</Badge>
                </summary>
                <div className="border-t border-border">
                  <TableContainer className="rounded-none border-0">
                    <TableHead>
                      <Th>URL</Th>
                      <Th>Matched pattern</Th>
                      <Th>Found on</Th>
                    </TableHead>
                    <tbody>
                      {g.items.map((s, i) => {
                        const foundOnPageId = s.foundOn ? findPageIdByUrl(pages, s.foundOn) : null;
                        return (
                          <Tr key={`${s.url}-${i}`}>
                            <Td className="max-w-xs truncate normal-case">{s.url}</Td>
                            <Td className="max-w-[16ch] truncate normal-case text-secondary">{s.matchedPattern}</Td>
                            <Td className="max-w-xs truncate normal-case">
                              {s.foundOn ? (
                                foundOnPageId ? (
                                  <Link href={`/pages/${foundOnPageId}?${q}`} className="text-primary underline underline-offset-2">
                                    {s.foundOn}
                                  </Link>
                                ) : (
                                  s.foundOn
                                )
                              ) : (
                                <span className="text-faint">—</span>
                              )}
                            </Td>
                          </Tr>
                        );
                      })}
                    </tbody>
                  </TableContainer>
                </div>
              </details>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-foreground">Robots.txt evidence</h2>
        {robots ? (
          <Card>
            <div className="mb-2 flex items-center justify-between">
              <p className="truncate text-sm text-foreground">{robots.url}</p>
              <Badge tone={robots.parseStatus === "ok" ? "ok" : robots.parseStatus === "error" ? "danger" : "neutral"}>
                {robots.parseStatus}
              </Badge>
            </div>
            <p className="mb-2 text-xs text-faint">
              status {robots.statusCode ?? "—"} · fetched {new Date(robots.fetchedAt).toLocaleString()} ·{" "}
              {robots.sitemaps.length} sitemap declaration{robots.sitemaps.length === 1 ? "" : "s"}
            </p>
            {robots.sitemaps.length > 0 && (
              <ul className="mb-2 space-y-0.5 text-xs text-secondary">
                {robots.sitemaps.map((s) => (
                  <li key={s} className="truncate">
                    {s}
                  </li>
                ))}
              </ul>
            )}
            <pre className="max-h-64 overflow-auto rounded-control border border-border bg-elevated p-3 text-xs text-secondary">
              {robots.content ?? "(no content)"}
            </pre>
          </Card>
        ) : (
          <p className="text-sm text-faint">No robots.txt evidence recorded for this run.</p>
        )}
      </section>
    </div>
  );
}
