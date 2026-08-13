import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getCrawlStatus, tailLog, reportReady } from "@/lib/crawl-runner";
import { readRunMeta, writeRunMeta, runsDirPath } from "@/lib/crawl-control";
import { isSafeId, badRequest, notFound } from "@/lib/api-shared";
import { requireApiSession } from "@/lib/auth-guard";

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const { runId } = await params;
  const status = await getCrawlStatus(runId);
  if (!status) {
    return NextResponse.json({ error: `No crawl status found for runId "${runId}".` }, { status: 404 });
  }
  const [log, ready, meta] = await Promise.all([tailLog(runId, 30), reportReady(runId), readRunMeta(runId)]);
  return NextResponse.json({ ...status, log, reportReady: ready, meta });
}

/** PATCH { label?, notes?, tags? } — additive dashboard-only metadata (spec §7 "Label / notes /
 *  tags"); stored in a sidecar file, never mutates report.json or any crawler-owned artifact. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
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
  if (typeof body !== "object" || body === null) return badRequest("Request body must be a JSON object.");
  const { label, notes, tags } = body as { label?: unknown; notes?: unknown; tags?: unknown };
  if (label !== undefined && label !== null && typeof label !== "string") return badRequest("label must be a string.");
  if (notes !== undefined && notes !== null && typeof notes !== "string") return badRequest("notes must be a string.");
  if (tags !== undefined && !(Array.isArray(tags) && tags.every((t) => typeof t === "string"))) return badRequest("tags must be a string array.");

  const runDir = path.join(runsDirPath(), runId);
  try {
    await stat(runDir);
  } catch {
    return notFound(`No run directory found for "${runId}".`);
  }
  const meta = await writeRunMeta(runId, { label: label as string | null, notes: notes as string | null, tags: tags as string[] | undefined });
  return NextResponse.json(meta);
}

/** DELETE ?confirm=true — deletes the run directory + every artifact under it. Irreversible;
 *  the ?confirm=true gate (spec §7) is load-bearing, not decorative. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const { runId } = await params;
  if (!isSafeId(runId)) return badRequest("Invalid runId.");
  if (request.nextUrl.searchParams.get("confirm") !== "true") {
    return badRequest("Deleting a run is irreversible. Pass ?confirm=true to proceed.");
  }
  const runDir = path.join(runsDirPath(), runId);
  const resolved = path.resolve(runDir);
  const root = path.resolve(runsDirPath());
  if (!resolved.startsWith(root + path.sep)) return badRequest("Invalid runId.");
  try {
    await stat(resolved);
  } catch {
    return notFound(`No run directory found for "${runId}".`);
  }
  await rm(resolved, { recursive: true, force: true });
  return new NextResponse(null, { status: 204 });
}
