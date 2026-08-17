import { NextRequest, NextResponse } from "next/server";
import { gscSession, gscErrorResponse, resolveLinkedProperty } from "@/lib/gsc/route-helpers";
import { readInspections } from "@/lib/gsc/storage";
import { startCrawl, CrawlConflictError } from "@/lib/crawl-runner";

/** Google's published ceiling for a targeted crawl's seed list (mirrors the reference project). */
const MAX_SEED_URLS = 2_000;

/**
 * POST { reason, pageUrls? } — queue the dashboard's own crawler for the URLs Google
 * excluded under one inspection reason.
 *
 * This is the app's crawler, not Google's Request Indexing action: it fetches the excluded
 * pages so our analysis can see exactly what Google saw (a noindex tag, a redirect, a 403).
 * Only exact stored NEUTRAL inspection rows with the given coverageState are eligible, and a
 * client-supplied URL list is intersected with that set — a caller can narrow the reason filter
 * with a URL search, but can never make the worker fetch arbitrary URLs.
 */
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
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const reason = (body as { reason?: unknown } | undefined)?.reason;
  if (typeof reason !== "string" || reason.length === 0 || reason.length > 500) {
    return NextResponse.json({ error: "unsupported_reason", message: "A valid exclusion reason is required." }, { status: 400 });
  }

  const requested = Array.isArray((body as { pageUrls?: unknown } | undefined)?.pageUrls)
    ? [...new Set(((body as { pageUrls: unknown[] }).pageUrls).filter((u): u is string => typeof u === "string"))]
    : null;
  if (requested !== null && requested.length > MAX_SEED_URLS) {
    return NextResponse.json(
      { error: "too_many_urls", message: `A targeted crawl can include at most ${MAX_SEED_URLS} URLs.` },
      { status: 400 },
    );
  }

  const store = await readInspections(__auth.userId, linked.domain);
  const matching = new Set(
    (store?.rows ?? [])
      .filter((i) => i.verdict === "NEUTRAL" && i.coverageState === reason)
      .map((i) => i.pageUrl),
  );
  // Intersect with the stored set — never crawl URLs Google hasn't excluded under this reason.
  const seedUrls = (requested ?? [...matching]).filter((url) => matching.has(url)).slice(0, MAX_SEED_URLS);
  if (seedUrls.length === 0) {
    return NextResponse.json(
      { error: "no_matching_urls", message: "No inspected URLs match this reason." },
      { status: 409 },
    );
  }

  try {
    // Depth 0 + the seed list means only the excluded URLs are fetched; maxPages is the seed
    // count so the frontier can't wander past the operator's ask.
    const status = await startCrawl({
      startUrl: seedUrls[0] as string,
      seedUrls,
      maxDepth: 0,
      maxPages: seedUrls.length,
      respectRobots: true,
    });
    return NextResponse.json({ runId: status.runId, urlsQueued: seedUrls.length }, { status: 201 });
  } catch (err) {
    if (err instanceof CrawlConflictError) {
      return NextResponse.json({ error: "crawl_conflict", message: err.message }, { status: 409 });
    }
    return gscErrorResponse(err);
  }
}
