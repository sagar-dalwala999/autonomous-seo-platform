/**
 * Shared helpers for the /api/gsc/* route handlers.
 *
 * Every GSC route (except the OAuth callback) sits behind the dashboard's
 * normal session gate and reads the user id from the verified Supabase claims
 * (`sub`). Google-specific failures are mapped to typed responses so the UI
 * can act on them: a dead grant is a 409 ("reconnect"), not a 500.
 */
import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth-guard";
import { GscConnectionExpiredError, GscNotConfiguredError } from "./oauth";
import { readLinkedProperty, domainKey } from "./storage";
import type { GscLinkedProperty } from "./types";

export type GscSessionResult = { userId: string } | { response: NextResponse };

/** Returns the verified user id, or a 401 response when absent. */
export async function gscSession(): Promise<GscSessionResult> {
  const __auth = await requireApiSession();
  if ("response" in __auth) return { response: __auth.response };
  const sub = __auth.claims.sub;
  if (typeof sub !== "string" || sub.length === 0) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { userId: sub };
}

/** Maps known Google/OAuth failures to typed responses; rethrows the rest. */
export function gscErrorResponse(err: unknown): NextResponse {
  if (err instanceof GscConnectionExpiredError) {
    return NextResponse.json({ error: "connection_expired", message: err.message }, { status: 409 });
  }
  if (err instanceof GscNotConfiguredError) {
    return NextResponse.json({ error: "not_configured", message: err.message }, { status: 503 });
  }
  throw err;
}

/** Normalises a URL path-segment domain and confirms a linked property exists. */
export async function resolveLinkedProperty(
  userId: string,
  domainParam: string,
): Promise<{ domain: string; property: GscLinkedProperty } | { response: NextResponse }> {
  const domain = domainKey(domainParam);
  const property = await readLinkedProperty(userId, domain);
  if (!property) {
    return { response: NextResponse.json({ error: "not_found", message: "No Search Console property is linked to this site." }, { status: 404 }) };
  }
  return { domain, property };
}
