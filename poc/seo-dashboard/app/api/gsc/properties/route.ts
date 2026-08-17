import { NextResponse } from "next/server";
import { gscSession, gscErrorResponse } from "@/lib/gsc/route-helpers";
import { listSites, canReadData } from "@/lib/gsc/client";
import { listLinkedDomains, readLinkedProperty, readConnection } from "@/lib/gsc/storage";
import { propertyMatchesDomain, propertyTypeOf } from "@/lib/gsc/url";
import { listSites as listCrawledSites } from "@/lib/gsc/sites";
import type { GscProperty } from "@/lib/gsc/types";

/** GET — properties the connected Google account can read, each annotated with the
 *  domain it is already linked to (if any) and which crawled domains look like a match. */
export async function GET() {
  const __auth = await gscSession();
  if ("response" in __auth) return __auth.response;
  const userId = __auth.userId;

  const connection = await readConnection(userId);
  if (!connection) {
    return NextResponse.json({ error: "not_connected" }, { status: 409 });
  }

  try {
    const [sites, linkedDomains, crawledSites] = await Promise.all([listSites(userId), listLinkedDomains(userId), listCrawledSites()]);
    const linkedBySiteUrl = new Map<string, string>();
    for (const domain of linkedDomains) {
      const prop = await readLinkedProperty(userId, domain);
      if (prop) linkedBySiteUrl.set(prop.siteUrl, domain);
    }
    const crawledDomains = crawledSites.map((s) => s.domain);

    const properties: GscProperty[] = sites.map((s) => ({
      siteUrl: s.siteUrl,
      permissionLevel: s.permissionLevel,
      propertyType: propertyTypeOf(s.siteUrl),
      canReadData: canReadData(s.permissionLevel),
      linkedDomain: linkedBySiteUrl.get(s.siteUrl) ?? null,
      suggestedDomains: crawledDomains.filter((d) => propertyMatchesDomain(s.siteUrl, d)),
    }));

    return NextResponse.json({ properties });
  } catch (err) {
    return gscErrorResponse(err);
  }
}
