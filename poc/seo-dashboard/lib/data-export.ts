/**
 * Server-only. New lib file. POST /crawls/:id/exports + GET /exports/:id + GET /exports (spec
 * §7). Same "no job queue in this POC" reasoning as data-comparisons.ts: computed synchronously,
 * persisted to storage/exports/, `status` returned as 'completed' immediately rather than faking
 * an async pending state.
 */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { getPages, getRun, listRuns } from "./data";
import { readAnalysisReport } from "./data-issues";
import { toCsv } from "./csv";

const STORAGE_ROOT = process.env.CRAWLER_STORAGE_DIR
  ? path.resolve(process.cwd(), process.env.CRAWLER_STORAGE_DIR)
  : path.resolve(process.cwd(), "..", "seo-crawler-poc", "storage");
const EXPORTS_DIR = path.join(STORAGE_ROOT, "exports");

export type ExportDataset = "pages" | "issues" | "links" | "media" | "failures" | "sitemap" | "fix-plan" | "full";
export type ExportFormat = "csv" | "json" | "ndjson";

export interface ExportMeta {
  id: string;
  runId: string;
  dataset: ExportDataset;
  format: ExportFormat;
  status: "completed" | "failed";
  rows: number;
  bytes: number;
  createdAt: string;
  error?: string;
}

export class ExportError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function buildRows(runId: string, dataset: ExportDataset): Promise<Record<string, unknown>[]> {
  if (dataset === "pages") {
    const pages = await getPages(runId);
    return pages.map((p) => ({
      pageId: p.pageId,
      url: p.url,
      statusCode: p.statusCode,
      title: p.title,
      metaDescription: p.metaDescription,
      canonical: p.canonical,
      noindex: p.robots.noindex,
      depth: p.crawl.depth,
      wordCount: p.content.wordCount,
      responseTimeMs: p.performance.responseTimeMs,
      renderedWith: p.renderedWith,
    }));
  }
  if (dataset === "issues" || dataset === "fix-plan") {
    const report = await readAnalysisReport(runId);
    if (!report) return [];
    return report.issues.map((i) => ({ ruleId: i.ruleId, category: i.category, severity: i.severity, scope: i.scope, url: i.url, pageId: i.pageId, message: i.message, howToFix: i.howToFix }));
  }
  if (dataset === "links") {
    const pages = await getPages(runId);
    const rows: Record<string, unknown>[] = [];
    for (const p of pages) for (const l of p.links) rows.push({ sourceUrl: p.url, target: l.target, type: l.type, anchor: l.anchor, nofollow: l.nofollow });
    return rows;
  }
  if (dataset === "media") {
    const pages = await getPages(runId);
    const rows: Record<string, unknown>[] = [];
    for (const p of pages) for (const img of p.images) rows.push({ pageUrl: p.url, kind: "image", src: img.url, alt: img.alt, width: img.width, height: img.height });
    return rows;
  }
  if (dataset === "failures") {
    const { failures } = await getRun(runId);
    return failures.map((f) => ({ url: f.url, reason: f.reason, statusCode: f.statusCode, attempts: f.attempts, error: f.error }));
  }
  if (dataset === "sitemap") {
    const { sitemaps } = await getRun(runId);
    return sitemaps?.entries.map((e) => ({ url: e.url, sourceSitemap: e.sourceSitemap })) ?? [];
  }
  return []; // "full" is intentionally not built — see route handler's 501
}

function extFor(format: ExportFormat): string {
  return format === "csv" ? "csv" : format === "ndjson" ? "ndjson" : "json";
}

export async function createExport(runId: string, dataset: ExportDataset, format: ExportFormat): Promise<ExportMeta> {
  const runs = await listRuns();
  if (!runs.some((r) => r.runId === runId)) throw new ExportError(`No completed run found for "${runId}".`, 404);
  if (dataset === "full") throw new ExportError('dataset "full" is not implemented — export one dataset at a time (pages, issues, links, media, failures, sitemap, fix-plan).', 422);

  const rows = await buildRows(runId, dataset);
  const id = randomUUID();
  await mkdir(EXPORTS_DIR, { recursive: true });

  let content: string;
  if (format === "csv") content = toCsv(rows);
  else if (format === "ndjson") content = rows.map((r) => JSON.stringify(r)).join("\n");
  else content = JSON.stringify(rows, null, 2);

  const fileName = `${id}.${extFor(format)}`;
  await writeFile(path.join(EXPORTS_DIR, fileName), content, "utf8");

  const meta: ExportMeta = { id, runId, dataset, format, status: "completed", rows: rows.length, bytes: Buffer.byteLength(content, "utf8"), createdAt: new Date().toISOString() };
  await writeFile(path.join(EXPORTS_DIR, `${id}.meta.json`), JSON.stringify(meta, null, 2), "utf8");
  return meta;
}

export async function getExportMeta(id: string): Promise<ExportMeta | null> {
  try {
    return JSON.parse(await readFile(path.join(EXPORTS_DIR, `${id}.meta.json`), "utf8")) as ExportMeta;
  } catch {
    return null;
  }
}

export async function listExports(runId?: string | null): Promise<ExportMeta[]> {
  try {
    await stat(EXPORTS_DIR);
  } catch {
    return [];
  }
  const files = (await readdir(EXPORTS_DIR)).filter((f) => f.endsWith(".meta.json"));
  const all = await Promise.all(
    files.map(async (f) => {
      try {
        return JSON.parse(await readFile(path.join(EXPORTS_DIR, f), "utf8")) as ExportMeta;
      } catch {
        return null;
      }
    }),
  );
  let rows = all.filter((r): r is ExportMeta => r !== null);
  if (runId) rows = rows.filter((r) => r.runId === runId);
  return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function readExportFile(id: string): Promise<{ content: string; contentType: string; fileName: string } | null> {
  const meta = await getExportMeta(id);
  if (!meta) return null;
  const fileName = `${id}.${extFor(meta.format)}`;
  try {
    const content = await readFile(path.join(EXPORTS_DIR, fileName), "utf8");
    const contentType = meta.format === "csv" ? "text/csv" : meta.format === "ndjson" ? "application/x-ndjson" : "application/json";
    return { content, contentType, fileName };
  } catch {
    return null;
  }
}
