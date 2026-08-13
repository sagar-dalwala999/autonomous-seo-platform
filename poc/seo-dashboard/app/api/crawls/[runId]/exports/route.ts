import { NextResponse } from "next/server";
import { createExport, ExportError, type ExportDataset, type ExportFormat } from "@/lib/data-export";
import { isSafeId, badRequest } from "@/lib/api-shared";
import { requireApiSession } from "@/lib/auth-guard";

const DATASETS: ExportDataset[] = ["pages", "issues", "links", "media", "failures", "sitemap", "fix-plan", "full"];
const FORMATS: ExportFormat[] = ["csv", "json", "ndjson"];

/** POST /crawls/:id/exports { dataset, format, filters? } — creates an export (spec §7).
 *  Computed synchronously at POC scale; see lib/data-export.ts's header note. `filters` is
 *  accepted but not yet applied (the per-dataset builders export the full stored set) — noted in
 *  the response rather than silently ignored. */
export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const { runId } = await params;
  if (!isSafeId(runId)) return badRequest("Invalid runId.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Request body must be JSON.");
  }
  const { dataset, format, filters } = (body ?? {}) as { dataset?: unknown; format?: unknown; filters?: unknown };
  if (!DATASETS.includes(dataset as ExportDataset)) return badRequest(`dataset must be one of ${DATASETS.join(", ")}.`);
  if (!FORMATS.includes(format as ExportFormat)) return badRequest(`format must be one of ${FORMATS.join(", ")}.`);

  try {
    const meta = await createExport(runId, dataset as ExportDataset, format as ExportFormat);
    return NextResponse.json({ exportId: meta.id, filtersApplied: false, filtersReceived: filters ?? null }, { status: 202 });
  } catch (err) {
    if (err instanceof ExportError) return NextResponse.json({ error: { code: "EXPORT_ERROR", message: err.message } }, { status: err.status });
    console.error(`[api/crawls/${runId}/exports] unexpected error`, err);
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "Failed to create export." } }, { status: 500 });
  }
}
