import { NextResponse } from "next/server";
import { gscSession, gscErrorResponse, resolveLinkedProperty } from "@/lib/gsc/route-helpers";
import { syncPropertyMetrics } from "@/lib/gsc/sync";

/** POST — pulls the metric window for a linked property and stores it. */
export async function POST(_request: Request, { params }: { params: Promise<{ domain: string }> }) {
  const __auth = await gscSession();
  if ("response" in __auth) return __auth.response;

  const { domain: domainParam } = await params;
  const linked = await resolveLinkedProperty(__auth.userId, domainParam);
  if ("response" in linked) return linked.response;

  try {
    const result = await syncPropertyMetrics(__auth.userId, linked.domain, linked.property.siteUrl);
    return NextResponse.json(result);
  } catch (err) {
    return gscErrorResponse(err);
  }
}
