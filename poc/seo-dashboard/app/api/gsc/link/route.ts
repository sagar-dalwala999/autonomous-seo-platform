import { NextRequest, NextResponse } from "next/server";
import { gscSession, gscErrorResponse } from "@/lib/gsc/route-helpers";
import { listSites, canReadData } from "@/lib/gsc/client";
import { readConnection, readLinkedProperty, writeLinkedProperty, deleteLinkedProperty, domainKey } from "@/lib/gsc/storage";
import { propertyTypeOf } from "@/lib/gsc/url";
import type { GscLinkedProperty } from "@/lib/gsc/types";

/** POST { domain, siteUrl } — links one Search Console property to one crawled domain. */
export async function POST(request: NextRequest) {
  const __auth = await gscSession();
  if ("response" in __auth) return __auth.response;
  const userId = __auth.userId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const { domain: rawDomain, siteUrl } = (body ?? {}) as { domain?: unknown; siteUrl?: unknown };
  if (typeof rawDomain !== "string" || typeof siteUrl !== "string" || !rawDomain.trim() || !siteUrl.trim()) {
    return NextResponse.json({ error: "domain and siteUrl are required" }, { status: 400 });
  }
  const domain = domainKey(rawDomain);

  const connection = await readConnection(userId);
  if (!connection) {
    return NextResponse.json({ error: "not_connected" }, { status: 409 });
  }

  try {
    // Confirm the property is one this Google account can actually read, so a
    // crafted siteUrl can't create a link that only fails later at sync time.
    const sites = await listSites(userId);
    const match = sites.find((s) => s.siteUrl === siteUrl);
    if (!match) {
      return NextResponse.json({ error: "property_not_found" }, { status: 404 });
    }
    if (!canReadData(match.permissionLevel)) {
      return NextResponse.json(
        {
          error: "property_unverified",
          message:
            `Google lists "${siteUrl}" for this account but ownership was never verified (${match.permissionLevel}), ` +
            "so it returns no data. Open Search Console, verify the property, then link it again.",
        },
        { status: 409 },
      );
    }

    const property: GscLinkedProperty = {
      domain,
      siteUrl,
      propertyType: propertyTypeOf(siteUrl),
      permissionLevel: match.permissionLevel,
      lastSyncedAt: null,
      createdAt: new Date().toISOString(),
    };
    await writeLinkedProperty(userId, property);
    return NextResponse.json({ property });
  } catch (err) {
    return gscErrorResponse(err);
  }
}

/** DELETE ?domain=... — unlinks the property from a domain. */
export async function DELETE(request: NextRequest) {
  const __auth = await gscSession();
  if ("response" in __auth) return __auth.response;
  const userId = __auth.userId;

  const rawDomain = request.nextUrl.searchParams.get("domain");
  if (!rawDomain) {
    return NextResponse.json({ error: "domain is required" }, { status: 400 });
  }
  const domain = domainKey(rawDomain);
  const existing = await readLinkedProperty(userId, domain);
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  await deleteLinkedProperty(userId, domain);
  return NextResponse.json({ unlinked: true });
}
