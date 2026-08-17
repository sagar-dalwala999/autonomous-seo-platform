import { NextResponse } from "next/server";
import { gscSession } from "@/lib/gsc/route-helpers";
import { listSites as listCrawledSites } from "@/lib/gsc/sites";
import { readLinkedProperty } from "@/lib/gsc/storage";
import type { GscSite } from "@/lib/gsc/types";

/** GET — every domain the dashboard has crawled, annotated with its linked GSC property. */
export async function GET() {
  const __auth = await gscSession();
  if ("response" in __auth) return __auth.response;
  const userId = __auth.userId;

  const crawled = await listCrawledSites();
  const sites: GscSite[] = [];
  for (const site of crawled) {
    const prop = await readLinkedProperty(userId, site.domain);
    sites.push({ ...site, linkedSiteUrl: prop?.siteUrl ?? null });
  }
  return NextResponse.json({ sites });
}
