import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { CrawledPageWithId } from "@/lib/types";
import { statusTone } from "@/lib/explorer-shared";
import { ImageThumb } from "./image-thumb";
import { StructuredDataBlock } from "./structured-data-block";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-faint">{children}</h2>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-faint">{children}</p>;
}

function pathKeyOf(raw: string): string | null {
  try {
    const u = new URL(raw);
    return `${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

// ---- 1. Header band (identity strip — outside the section nav) ----------

export function HeaderBand({ page, runId, pagerank }: { page: CrawledPageWithId; runId: string; pagerank?: number | null }) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="break-all text-base font-semibold text-foreground">{page.url}</p>
          <p className="mt-1 text-xs text-faint">
            fetched {page.fetchedAt ? new Date(page.fetchedAt).toLocaleString() : "—"} ·{" "}
            {page.performance.responseTimeMs !== null ? `${page.performance.responseTimeMs}ms` : "no timing"} · run {runId}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {pagerank !== undefined && pagerank !== null && (
            <Badge tone="ok" title="Internal Link Authority PageRank">
              PR {pagerank.toFixed(4)}
            </Badge>
          )}
          {page.statusCode !== null ? (
            <Badge tone={statusTone(page.statusCode)}>{page.statusCode}</Badge>
          ) : (
            <Badge tone="neutral">no status</Badge>
          )}
          <Badge tone="neutral">{page.renderedWith}</Badge>
        </div>
      </div>

      {page.renderSignals.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-faint">Render signals:</span>
          {page.renderSignals.map((s) => (
            <Badge key={s} tone="warn">
              {s}
            </Badge>
          ))}
        </div>
      )}
    </Card>
  );
}

// ---- 1b. Crawl (depth, parent, discovery — a distinct section-nav entry) -

export function CrawlPanel({ page, runId, parentPageId }: { page: CrawledPageWithId; runId: string; parentPageId: string | null }) {
  const { crawl } = page;
  return (
    <Card id="crawl">
      <SectionTitle>Crawl</SectionTitle>
      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-faint">Depth</dt>
          <dd className="text-lg font-semibold tabular-nums text-foreground">{crawl.depth}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs text-faint">Parent URL</dt>
          <dd className="truncate text-foreground">
            {crawl.parentUrl === null ? (
              <span className="text-faint">— (seed)</span>
            ) : parentPageId ? (
              <Link href={`/pages/${parentPageId}?run=${encodeURIComponent(runId)}`} className="text-primary underline underline-offset-2">
                {crawl.parentUrl}
              </Link>
            ) : (
              crawl.parentUrl
            )}
          </dd>
        </div>
        <div>
          <dt className="mb-1 text-xs text-faint">Discovery sources</dt>
          <dd className="flex flex-wrap gap-1">
            {crawl.discoverySources.length === 0 ? (
              <span className="text-faint">—</span>
            ) : (
              crawl.discoverySources.map((s) =>
                s === "sitemap" ? (
                  <Link key={s} href={`/sitemap?run=${encodeURIComponent(runId)}`}>
                    <Badge tone="neutral" className="cursor-pointer hover:bg-elevated">
                      {s}
                    </Badge>
                  </Link>
                ) : (
                  <Badge key={s} tone="neutral">
                    {s}
                  </Badge>
                ),
              )
            )}
          </dd>
        </div>
      </dl>
    </Card>
  );
}

// ---- 2. Metadata ---------------------------------------------------------

export function MetadataPanel({ page }: { page: CrawledPageWithId }) {
  const canonicalKey = page.canonical ? pathKeyOf(page.canonical) : null;
  const pageKey = pathKeyOf(page.url);
  const canonicalMismatch = page.canonical !== null && canonicalKey !== null && canonicalKey !== pageKey;
  const xRobotsTag = page.headers["x-robots-tag"] ?? null;

  return (
    <Card id="metadata">
      <SectionTitle>Metadata</SectionTitle>
      <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-faint">Title ({page.title === null ? 0 : page.title.length} chars)</dt>
          <dd className="text-foreground">{page.title === null ? <span className="text-faint">null (missing)</span> : page.title === "" ? <span className="text-faint">(empty string)</span> : page.title}</dd>
        </div>
        <div>
          <dt className="text-xs text-faint">Meta description ({page.metaDescription === null ? 0 : page.metaDescription.length} chars)</dt>
          <dd className="text-foreground">
            {page.metaDescription === null ? (
              <span className="text-faint">null (missing)</span>
            ) : page.metaDescription === "" ? (
              <span className="text-faint">(empty string)</span>
            ) : (
              page.metaDescription
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-faint">Canonical</dt>
          <dd className="flex items-center gap-2 truncate text-foreground">
            {page.canonical === null ? (
              <span className="text-faint">— (none)</span>
            ) : (
              <>
                <span className="truncate">{page.canonical}</span>
                {canonicalMismatch && (
                  <Badge tone="warn" className="shrink-0">
                    points elsewhere
                  </Badge>
                )}
              </>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-faint">X-Robots-Tag header</dt>
          <dd className="text-foreground">{xRobotsTag === null ? <span className="text-faint">— (not sent)</span> : xRobotsTag}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="mb-1 text-xs text-faint">Robots meta (raw values)</dt>
          <dd className="flex flex-wrap items-center gap-1.5">
            {page.robots.meta.length === 0 ? (
              <span className="text-faint">— (no robots meta/header present)</span>
            ) : (
              page.robots.meta.map((m, i) => (
                <Badge key={`${m}-${i}`} tone="neutral">
                  {m}
                </Badge>
              ))
            )}
            <Badge tone={page.robots.noindex ? "danger" : "ok"}>{page.robots.noindex ? "noindex" : "indexable"}</Badge>
            <Badge tone={page.robots.nofollow ? "danger" : "ok"}>{page.robots.nofollow ? "nofollow" : "followable"}</Badge>
          </dd>
        </div>
      </dl>
    </Card>
  );
}

// ---- 3. Headings ----------------------------------------------------------

export function HeadingsPanel({ page }: { page: CrawledPageWithId }) {
  const { h1, h2, h3 } = page.headings;
  const total = h1.length + h2.length + h3.length;
  return (
    <Card id="headings">
      <div className="mb-3 flex items-center justify-between">
        <SectionTitle>Headings</SectionTitle>
        <span className="text-xs tabular-nums text-faint">
          H1 {h1.length} · H2 {h2.length} · H3 {h3.length}
        </span>
      </div>
      {total === 0 ? (
        <Empty>No headings found on this page.</Empty>
      ) : (
        <ol className="space-y-1 text-sm">
          {h1.map((t, i) => (
            <li key={`h1-${i}`} className="flex items-baseline gap-2">
              <Badge tone="neutral">H1</Badge>
              <span className="text-foreground">{t}</span>
            </li>
          ))}
          {h2.map((t, i) => (
            <li key={`h2-${i}`} className="ml-4 flex items-baseline gap-2">
              <Badge tone="neutral">H2</Badge>
              <span className="text-foreground">{t}</span>
            </li>
          ))}
          {h3.map((t, i) => (
            <li key={`h3-${i}`} className="ml-8 flex items-baseline gap-2">
              <Badge tone="neutral">H3</Badge>
              <span className="text-foreground">{t}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

// ---- 5. Images --------------------------------------------------------

export function ImagesPanel({ page }: { page: CrawledPageWithId }) {
  return (
    <Card id="images">
      <div className="mb-3 flex items-center justify-between">
        <SectionTitle>Images</SectionTitle>
        <span className="text-xs tabular-nums text-faint">{page.images.length} total</span>
      </div>
      {page.images.length === 0 ? (
        <Empty>No images found on this page.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead className="bg-subtle text-xs text-secondary">
              <tr className="border-b border-border">
                <th className="px-4 py-2.5 text-left font-medium">Preview</th>
                <th className="px-4 py-2.5 text-left font-medium">Src</th>
                <th className="px-4 py-2.5 text-left font-medium">Alt</th>
                <th className="px-4 py-2.5 text-left font-medium">Dimensions</th>
                <th className="px-4 py-2.5 text-left font-medium">Format</th>
              </tr>
            </thead>
            <tbody>
              {page.images.map((img, i) => (
                <tr key={`${img.url}-${i}`} className="min-h-11 border-b border-border last:border-0 hover:bg-subtle">
                  <td className="px-4 py-2.5">
                    <ImageThumb src={img.url} alt={img.alt ?? ""} />
                  </td>
                  <td className="max-w-xs truncate px-4 py-2.5">{img.url}</td>
                  <td className="px-4 py-2.5">
                    {img.alt === null ? (
                      <Badge tone="danger">missing</Badge>
                    ) : img.alt === "" ? (
                      <Badge tone="warn">empty</Badge>
                    ) : (
                      <span className="text-foreground">{img.alt}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">
                    {img.width !== null && img.height !== null ? `${img.width}×${img.height}` : <span className="text-faint">—</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    {img.format === null ? (
                      <span className="text-faint">—</span>
                    ) : img.format === "bmp" ? (
                      <Badge tone="danger">
                        <AlertTriangle size={10} strokeWidth={2} className="mr-1 inline" aria-hidden="true" />
                        bmp
                      </Badge>
                    ) : (
                      <span className="text-secondary">{img.format}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ---- 6. Structured data --------------------------------------------------

export function StructuredDataPanel({ page }: { page: CrawledPageWithId }) {
  return (
    <Card id="structured-data">
      <div className="mb-3 flex items-center justify-between">
        <SectionTitle>Structured data</SectionTitle>
        <span className="text-xs tabular-nums text-faint">{page.structuredData.length} block(s)</span>
      </div>
      {page.structuredData.length === 0 ? (
        <Empty>No structured data on this page.</Empty>
      ) : (
        <div className="space-y-3">
          {page.structuredData.map((sd, i) => (
            <StructuredDataBlock key={i} sd={sd} />
          ))}
        </div>
      )}
    </Card>
  );
}

// ---- 8. Redirect chain -----------------------------------------------

export function RedirectChainPanel({ page }: { page: CrawledPageWithId }) {
  return (
    <Card id="redirects">
      <div className="mb-3 flex items-center justify-between">
        <SectionTitle>Redirect chain</SectionTitle>
        <span className="text-xs tabular-nums text-faint">{page.redirectChain.length} hop(s)</span>
      </div>
      {page.redirectChain.length === 0 ? (
        <Empty>This page was not redirected.</Empty>
      ) : (
        <ol className="space-y-2 text-sm">
          {page.redirectChain.map((hop, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 rounded-control border border-border bg-subtle px-3 py-2">
              <span className="tabular-nums text-faint">#{i + 1}</span>
              <span className="truncate text-foreground">{hop.from}</span>
              <ArrowRight size={14} strokeWidth={1.75} className="shrink-0 text-faint" aria-hidden="true" />
              <span className="truncate text-foreground">{hop.to}</span>
              <Badge tone="warn" className="ml-auto shrink-0">
                {hop.statusCode}
              </Badge>
            </li>
          ))}
          {page.finalUrl && (
            <li className="flex items-center gap-2 px-3 text-xs text-faint">
              Final: {page.finalUrl}
              {page.statusCode !== null && (
                <Badge tone={statusTone(page.statusCode)} className="ml-1">
                  {page.statusCode}
                </Badge>
              )}
            </li>
          )}
        </ol>
      )}
    </Card>
  );
}

// ---- 9. Headers --------------------------------------------------------

export function HeadersPanel({ page }: { page: CrawledPageWithId }) {
  const entries = Object.entries(page.headers);
  return (
    <Card id="headers">
      <SectionTitle>Captured headers</SectionTitle>
      {entries.length === 0 ? (
        <Empty>No headers captured.</Empty>
      ) : (
        <dl className="space-y-1.5 text-sm">
          {entries.map(([k, v]) => (
            <div key={k} className="flex gap-3 border-b border-border pb-1.5 last:border-0">
              <dt className="w-40 shrink-0 truncate text-xs text-faint">{k}</dt>
              <dd className="min-w-0 flex-1 truncate text-foreground">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}
