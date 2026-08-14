import { stat } from "node:fs/promises";
import Link from "next/link";
import { FileText } from "lucide-react";
import { resolveRunId, getPage, getPages, rawHtmlPath } from "@/lib/data";
import { buildExplorerRows, findPageIdByUrl } from "@/lib/data-explorer";
import { readAnalysisReport, findingsForPage } from "@/lib/data-issues";
import { filterAndSortRows, type ExplorerFilterParams, type SortKey, type StatusBucket } from "@/lib/explorer-shared";
import { EmptyState } from "@/components/ui/empty-state";
import {
  HeaderBand,
  CrawlPanel,
  MetadataPanel,
  HeadingsPanel,
  ImagesPanel,
  StructuredDataPanel,
  RedirectChainPanel,
  HeadersPanel,
} from "@/components/explorer/evidence-panels";
import { LinksPanel } from "@/components/explorer/links-panel";
import { MediaPanel } from "@/components/explorer/media-panel";
import { ContentPanel } from "@/components/explorer/collapsible-text";
import { PageActions } from "@/components/explorer/page-actions";
import { PageReplay } from "@/components/preview/page-replay";
import { frameability } from "@/components/preview/frameability";
import { PageIssuesPanel } from "@/components/issues/page-issues-panel";
import { SectionNav } from "@/components/explorer/section-nav";
import { BreadcrumbNav } from "@/components/explorer/breadcrumb-nav";
import { Card } from "@/components/ui/card";
import { HeadMetadataPanel } from "@/components/page-detail/head-metadata-panel";
import { HeadIntegrityPanel } from "@/components/page-detail/head-integrity-panel";
import { FaviconsPanel } from "@/components/page-detail/favicons-panel";
import { FontsPanel } from "@/components/page-detail/fonts-panel";
import { DocumentStructurePanel } from "@/components/page-detail/document-structure-panel";
import type { ExtendedCrawledPage } from "@/components/page-detail/types";

interface SearchParams {
  run?: string;
  q?: string;
  status?: string;
  rendered?: string;
  depth?: string;
  sort?: string;
  dir?: string;
  section?: string;
}

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}

const STATUS_VALUES: StatusBucket[] = ["2xx", "3xx", "4xx", "5xx", "failed", "blocked"];
const SORT_VALUES: SortKey[] = ["url", "status", "depth", "wordCount", "responseTime"];

export default async function PageDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const runId = await resolveRunId(sp.run);

  const page = runId ? await getPage(runId, id) : null;

  if (!page || !runId) {
    return (
      <EmptyState
        icon={FileText}
        title="Page record not found"
        description={
          <>
            No <code className="rounded border border-border bg-elevated px-1 py-0.5 text-[11px]">{id}.json</code>{" "}
            under this run.{" "}
            <Link href="/pages" className="text-primary underline underline-offset-2">
              Back to Pages
            </Link>
          </>
        }
      />
    );
  }

  // Same filter context the list used, so "section" + Prev/Next stay inside what the user was viewing.
  const filterParams: ExplorerFilterParams = {
    q: sp.q ?? null,
    status: STATUS_VALUES.includes(sp.status as StatusBucket) ? (sp.status as StatusBucket) : null,
    rendered: sp.rendered === "http" || sp.rendered === "playwright" ? sp.rendered : null,
    depth: sp.depth !== undefined && sp.depth !== "" ? Number(sp.depth) : null,
    sort: SORT_VALUES.includes(sp.sort as SortKey) ? (sp.sort as SortKey) : null,
    dir: sp.dir === "desc" ? "desc" : "asc",
    section: sp.section ?? null,
  };

  const [allRows, { items: allPages }] = await Promise.all([buildExplorerRows(runId), getPages(runId, {})]);
  const filtered = filterAndSortRows(allRows, filterParams).filter((r) => r.pageId !== null);
  const currentIndex = filtered.findIndex((r) => r.pageId === id);
  const parentPageId = page.crawl.parentUrl ? findPageIdByUrl(allPages, page.crawl.parentUrl) : null;

  const hasRawHtml = await stat(rawHtmlPath(runId, page.pageId))
    .then(() => true)
    .catch(() => false);

  // staticRawSaved is the crawler's own record that a pre-render snapshot was stored.
  const hasStaticHtml = page.renderDivergence?.staticRawSaved === true;
  const frame = frameability(page.headers, page.url);

  const analysisReport = await readAnalysisReport(runId);
  const pageIssues = analysisReport ? findingsForPage(analysisReport, page.pageId) : [];

  const qs = new URLSearchParams();
  qs.set("run", runId);
  if (sp.q) qs.set("q", sp.q);
  if (filterParams.status) qs.set("status", filterParams.status);
  if (filterParams.rendered) qs.set("rendered", filterParams.rendered);
  if (filterParams.depth !== null) qs.set("depth", String(filterParams.depth));
  if (filterParams.sort) qs.set("sort", filterParams.sort);
  if (filterParams.dir === "desc") qs.set("dir", "desc");
  if (filterParams.section) qs.set("section", filterParams.section);
  const listQuery = `?${qs.toString()}`;

  const prevId = currentIndex > 0 ? filtered[currentIndex - 1].pageId : null;
  const nextId = currentIndex >= 0 && currentIndex < filtered.length - 1 ? filtered[currentIndex + 1].pageId : null;

  return (
    <div className="space-y-4 pb-8">
      <BreadcrumbNav
        url={page.url}
        runId={runId}
        listQuery={listQuery}
        prevHref={prevId ? `/pages/${prevId}` : null}
        nextHref={nextId ? `/pages/${nextId}` : null}
      />

      <Card className="flex flex-wrap items-center justify-between gap-3 bg-subtle">
        <p className="text-xs text-secondary">Full evidence record for this crawled page.</p>
        <PageActions page={page} runId={runId} hasRawHtml={hasRawHtml} />
      </Card>

      <HeaderBand page={page} runId={runId} />

      {/* No items-start here: sticky's containing block is this grid item's own box, and
          items-start would shrink it to the nav's short content height instead of the row's
          full height (matching the tall left column) — killing sticky after ~300px of scroll. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_180px]">
        <div className="min-w-0 space-y-4">
          <PageIssuesPanel issues={pageIssues} analyzed={Boolean(analysisReport)} runId={runId} />
          <MetadataPanel page={page} />
          <HeadMetadataPanel page={page as ExtendedCrawledPage} />
          <HeadIntegrityPanel page={page as ExtendedCrawledPage} />
          <FaviconsPanel page={page as ExtendedCrawledPage} />
          <FontsPanel page={page as ExtendedCrawledPage} />
          <HeadingsPanel page={page} />
          <DocumentStructurePanel page={page as ExtendedCrawledPage} />
          <LinksPanel links={page.links} />
          <ImagesPanel page={page} />
          <MediaPanel page={page} />
          <StructuredDataPanel page={page} />
          <ContentPanel text={page.content.text} wordCount={page.content.wordCount} contentHash={page.content.contentHash} />
          {hasRawHtml && (
            <div id="replay">
              <PageReplay
                runId={runId}
                pageId={page.pageId}
                pageUrl={page.url}
                statusCode={page.statusCode}
                fetchedAt={page.fetchedAt}
                hasStaticHtml={hasStaticHtml}
                canFrameLive={frame.canFrameLive}
                frameBlockedBy={frame.frameBlockedBy}
                hasScreenshot={Boolean(page.screenshot?.full)}
              />
            </div>
          )}
          <RedirectChainPanel page={page} />
          <HeadersPanel page={page} />
          <CrawlPanel page={page} runId={runId} parentPageId={parentPageId} />
        </div>
        <div className="order-first lg:order-last">
          <SectionNav />
        </div>
      </div>
    </div>
  );
}
