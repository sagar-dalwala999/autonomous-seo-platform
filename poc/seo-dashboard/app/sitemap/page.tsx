import Link from "next/link";
import { History, Map } from "lucide-react";
import { resolveRunId, getRun, getPages } from "@/lib/data";
import { findPageIdByUrl } from "@/lib/data-explorer";
import { EmptyState } from "@/components/ui/empty-state";
import { Card } from "@/components/ui/card";
import { StatValue } from "@/components/ui/stat-value";
import { Badge } from "@/components/ui/badge";

interface Props {
  searchParams: Promise<{ run?: string }>;
}

function CrossRefList({
  title,
  urls,
  runId,
  pages,
  tone,
  noLinkLabel,
}: {
  title: string;
  urls: string[];
  runId: string;
  pages: Awaited<ReturnType<typeof getPages>>["items"];
  tone: "warn" | "danger" | "neutral";
  noLinkLabel: string;
}) {
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <Badge tone={tone}>{urls.length}</Badge>
      </div>
      {urls.length === 0 ? (
        <p className="text-sm text-faint">None.</p>
      ) : (
        <ul className="max-h-72 space-y-1.5 overflow-y-auto text-xs">
          {urls.map((url) => {
            const pageId = findPageIdByUrl(pages, url);
            return (
              <li key={url} className="flex items-center justify-between gap-2 border-b border-border pb-1.5 last:border-0">
                {pageId ? (
                  <Link href={`/pages/${pageId}?run=${encodeURIComponent(runId)}`} className="truncate text-primary underline underline-offset-2">
                    {url}
                  </Link>
                ) : (
                  <>
                    <span className="truncate text-secondary">{url}</span>
                    <span className="shrink-0 whitespace-nowrap rounded-pill bg-subtle px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-faint">
                      {noLinkLabel}
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export default async function SitemapPage({ searchParams }: Props) {
  const { run } = await searchParams;
  const runId = await resolveRunId(run);

  if (!runId) {
    return <EmptyState icon={History} title="No crawl runs yet" description="Run a crawl to see robots.txt and sitemap evidence here." />;
  }

  const { robots, sitemaps, report } = await getRun(runId);
  const { items: pages } = await getPages(runId, {});

  if (!robots && !sitemaps) {
    return <EmptyState icon={Map} title="No robots/sitemap evidence for this run" />;
  }

  return (
    <div className="space-y-6">
      {report && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <StatValue value={report.sitemap.urlsInSitemap} caption="URLs in sitemap" />
          </Card>
          <Card>
            <StatValue value={report.sitemap.inSitemapNotCrawled.length} caption="In sitemap, not crawled" />
          </Card>
          <Card>
            <StatValue value={report.sitemap.crawledNotInSitemap.length} caption="Crawled, not in sitemap" />
          </Card>
        </div>
      )}

      {robots && (
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">robots.txt</h2>
            <Badge tone={robots.parseStatus === "ok" ? "ok" : robots.parseStatus === "error" ? "danger" : "neutral"}>
              {robots.parseStatus}
            </Badge>
          </div>
          <p className="mb-2 text-xs text-faint">
            {robots.url} · fetched {new Date(robots.fetchedAt).toLocaleString()} · {robots.sitemaps.length} sitemap
            declaration{robots.sitemaps.length === 1 ? "" : "s"}
          </p>
          <pre className="max-h-64 overflow-auto rounded-control border border-border bg-elevated p-3 text-xs text-secondary">
            {robots.content ?? "(no content)"}
          </pre>
        </Card>
      )}

      {sitemaps && sitemaps.files.length > 0 && (
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Sitemap files</h2>
            <span className="text-xs tabular-nums text-faint">{sitemaps.entries.length} total entries</span>
          </div>
          <ul className="space-y-1.5 text-xs">
            {sitemaps.files.map((f) => (
              <li key={f.url} className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-1.5 last:border-0">
                <span className="truncate text-secondary">{f.url}</span>
                <span className="shrink-0 tabular-nums text-faint">
                  {f.kind} · {f.urlCount} url{f.urlCount === 1 ? "" : "s"} ·{" "}
                  {f.error ? <Badge tone="danger">{f.statusCode ?? "error"}</Badge> : (f.statusCode ?? "—")}
                </span>
              </li>
            ))}
          </ul>
          {sitemaps.errors.length > 0 && (
            <ul className="mt-2 space-y-1 border-t border-border pt-2 text-xs text-danger">
              {sitemaps.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {report && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <CrossRefList title="In sitemap, not crawled" urls={report.sitemap.inSitemapNotCrawled} runId={runId} pages={pages} tone="warn" noLinkLabel="never crawled" />
          <CrossRefList title="Crawled, not in sitemap" urls={report.sitemap.crawledNotInSitemap} runId={runId} pages={pages} tone="neutral" noLinkLabel="no page match" />
          <CrossRefList title="Sitemap entries failed" urls={report.sitemap.sitemapEntriesFailed} runId={runId} pages={pages} tone="danger" noLinkLabel="never crawled" />
        </div>
      )}
    </div>
  );
}
