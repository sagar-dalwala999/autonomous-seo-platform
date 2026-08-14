import Link from "next/link";
import { History, Map as MapIcon } from "lucide-react";
import { resolveRunId, getRun, getPages, readSkipped } from "@/lib/data";
import { findPageIdByUrl } from "@/lib/data-explorer";
import { buildAiAccessTable } from "@/lib/data-sitefiles";
import { findRuleSourceLine } from "@/lib/sitefiles-lines";
import { EmptyState } from "@/components/ui/empty-state";
import { Card } from "@/components/ui/card";
import { StatValue } from "@/components/ui/stat-value";
import { Badge } from "@/components/ui/badge";
import { RobotsPanel } from "@/components/sitemap/robots-panel";
import { LlmsPanel } from "@/components/sitemap/llms-panel";
import { AiCrawlerHeadline, AiCrawlerTable } from "@/components/sitemap/ai-crawler-table";
import { FailuresSections } from "@/components/sitemap/failures-sections";

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
  pages: Awaited<ReturnType<typeof getPages>>;
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

  const { robots, sitemaps, report, blocked, failures } = await getRun(runId);
  const pages = await getPages(runId);
  const skipped = await readSkipped(runId);

  // Failures/blocked/skipped live here too (merged from the former /failures page), so the
  // empty state only fires when there is neither site evidence nor anything failed.
  if (!robots && !sitemaps && failures.length === 0 && blocked.length === 0 && skipped.length === 0) {
    return <EmptyState icon={MapIcon} title="No robots/sitemap evidence for this run" />;
  }

  // AI-crawler access table — moved here from the former /sitefiles ("What the site tells
  // crawlers") screen; consumed server-side via the same lib the /api/crawls/:id/site-files
  // routes use (this codebase's SSR convention).
  const aiAccess = await buildAiAccessTable(runId);
  const rows = aiAccess?.rows ?? [];
  const robotsAvailable = Boolean(robots?.content && robots.parseStatus === "ok");

  const sourceLines = new Map<string, number | null>();
  if (robotsAvailable && robots?.content) {
    for (const r of rows) {
      const ruleType: "allow" | "disallow" | null = r.verdict === "allowed" && r.allowRules[0] ? "allow" : r.verdict === "blocked" || r.verdict === "partly-blocked" ? "disallow" : null;
      const rulePath = ruleType === "allow" ? r.allowRules[0] ?? null : ruleType === "disallow" ? r.disallowRules[0] ?? null : null;
      sourceLines.set(r.agent, findRuleSourceLine(robots.content, r.matchedGroup, rulePath, ruleType));
    }
  }

  // llms.txt is probed by the crawler alongside robots.txt and stored on robots.json as
  // robots.llmsTxt (metadata, plus the body from the content-storing crawler version on).
  const llms = robots?.llmsTxt;
  const llmsTxt = llms
    ? {
        available: true,
        present: llms.present,
        url: llms.url,
        statusCode: llms.statusCode,
        bytes: llms.bytes,
        fetchedAt: llms.fetchedAt,
        content: llms.content ?? null,
        reason: llms.present
          ? llms.content
            ? null
            : "Fetched by this run's crawler, but that crawler version did not store the file body."
          : `llms.txt not found — HTTP ${llms.statusCode ?? "error"}.`,
      }
    : { available: false, reason: "llms.txt was not probed for this run (robots.json carries no llmsTxt field — crawler version predates llms.txt probing)." };

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

      <AiCrawlerHeadline rows={rows} />

      <AiCrawlerTable rows={rows} sourceLines={sourceLines} robotsAvailable={robotsAvailable} />

      {aiAccess && aiAccess.parseStatus !== "ok" && (
        <p className="text-xs text-faint">
          robots.txt parse status: <span className="font-medium text-foreground">{aiAccess.parseStatus}</span> — verdicts above fell back to &quot;unknown&quot; rather than guessing.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RobotsPanel robots={robots} sitemapCount={robots?.sitemaps.length ?? 0} />
        <LlmsPanel llmsTxt={llmsTxt} />
      </div>

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

      <FailuresSections runId={runId} failures={failures} blocked={blocked} skipped={skipped} pages={pages} />
    </div>
  );
}
