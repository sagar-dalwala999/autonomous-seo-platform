import { NextRequest, NextResponse } from "next/server";
import { gscSession, resolveLinkedProperty } from "@/lib/gsc/route-helpers";
import { resolveRange } from "@/lib/gsc/date-range";
import { ensureRangeData } from "@/lib/gsc/sync";
import { getMetricsResponse } from "@/lib/gsc/metrics";
import { GscConnectionExpiredError } from "@/lib/gsc/oauth";

/** How long a live range pull may block the request before we serve stored data. */
const RANGE_FETCH_TIMEOUT_MS = 25_000;

/** GET ?start&end&type=web|image — the metrics payload for the linked property. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ domain: string }> }) {
  const __auth = await gscSession();
  if ("response" in __auth) return __auth.response;

  const { domain: domainParam } = await params;
  const linked = await resolveLinkedProperty(__auth.userId, domainParam);
  if ("response" in linked) return linked.response;

  const sp = request.nextUrl.searchParams;
  const searchType = sp.get("type") === "image" ? "image" : "web";
  const range = resolveRange(sp.get("start") ?? undefined, sp.get("end") ?? undefined);

  // Pull anything the requested window doesn't already cover. Bounded: on
  // timeout we serve what we have and say it may be partial — the fetch that
  // timed out still completes in the background, so the next request for that
  // range is usually warm.
  let coverageFetch: { fetched: boolean; daysFetched: number; rowsWritten: number; failed?: boolean };
  try {
    coverageFetch = await Promise.race([
      ensureRangeData(__auth.userId, linked.domain, linked.property.siteUrl, range, searchType),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("range fetch exceeded 25s")), RANGE_FETCH_TIMEOUT_MS)),
    ]);
  } catch (err) {
    if (err instanceof GscConnectionExpiredError) {
      return NextResponse.json({ error: "connection_expired", message: err.message }, { status: 409 });
    }
    console.warn("[gsc] range fetch failed, serving stored data:", err instanceof Error ? err.message : err);
    coverageFetch = { fetched: false, daysFetched: 0, rowsWritten: 0, failed: true };
  }

  // Image Search can be substantially slower on large properties. Never make
  // the default Web Search dashboard wait for it: warm its rows in the
  // background, then the Image toggle is ready when the user opens it.
  if (searchType === "web") {
    void ensureRangeData(__auth.userId, linked.domain, linked.property.siteUrl, range, "image").catch((err) => {
      console.warn("[gsc] background image sync failed:", err instanceof Error ? err.message : err);
    });
  }

  const response = await getMetricsResponse(
    __auth.userId,
    linked.domain,
    linked.property.siteUrl,
    linked.property.propertyType,
    linked.property.lastSyncedAt,
    range,
    searchType,
    coverageFetch,
  );
  return NextResponse.json(response);
}
