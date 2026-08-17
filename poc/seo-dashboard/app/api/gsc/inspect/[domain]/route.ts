import { NextRequest, NextResponse } from "next/server";
import { gscSession, gscErrorResponse, resolveLinkedProperty } from "@/lib/gsc/route-helpers";
import { inspectPropertyUrls } from "@/lib/gsc/inspect";

/** POST { batchSize? } — inspects a batch of this property's URLs, highest-value first. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ domain: string }> }) {
  const __auth = await gscSession();
  if ("response" in __auth) return __auth.response;

  const { domain: domainParam } = await params;
  const linked = await resolveLinkedProperty(__auth.userId, domainParam);
  if ("response" in linked) return linked.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const requested = Number((body as { batchSize?: unknown } | undefined)?.batchSize);
  // Clamped to the daily quota, not an arbitrary cap.
  const batchSize = Number.isFinite(requested) ? Math.min(2000, Math.max(1, requested)) : undefined;

  try {
    const result = await inspectPropertyUrls(__auth.userId, linked.domain, linked.property.siteUrl, batchSize);
    return NextResponse.json(result);
  } catch (err) {
    return gscErrorResponse(err);
  }
}
