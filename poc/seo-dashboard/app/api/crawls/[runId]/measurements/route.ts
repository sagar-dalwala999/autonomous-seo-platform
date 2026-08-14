import { NextResponse } from "next/server";
import { buildMeasurements } from "@/lib/data-measurements";
import { isSafeId, badRequest, notFound } from "@/lib/api-shared";
import { requireApiSession } from "@/lib/auth-guard";

/** GET /crawls/:id/measurements — aggregate metrics grid (spec §7). */
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const { runId } = await params;
  if (!isSafeId(runId)) return badRequest("Invalid runId.");
  const measurements = await buildMeasurements(runId);
  if (!measurements) return notFound(`No completed run found for "${runId}".`);
  return NextResponse.json(measurements);
}
