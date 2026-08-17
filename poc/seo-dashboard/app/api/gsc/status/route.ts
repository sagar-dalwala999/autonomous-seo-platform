import { NextResponse } from "next/server";
import { gscSession } from "@/lib/gsc/route-helpers";
import { gscConfig } from "@/lib/gsc/oauth";
import { readConnection } from "@/lib/gsc/storage";
import type { GscStatus } from "@/lib/gsc/types";

/** GET — whether Search Console is configured, and whether this user has connected. */
export async function GET() {
  const __auth = await gscSession();
  if ("response" in __auth) return __auth.response;

  const configured = gscConfig() !== null;
  const connection = await readConnection(__auth.userId);
  const status: GscStatus = {
    configured,
    connected: Boolean(connection),
    connection: connection
      ? { id: connection.userId, googleEmail: connection.googleEmail, scopes: connection.scopes, createdAt: connection.createdAt }
      : null,
    setupHint: configured
      ? null
      : "Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to the dashboard's .env, then restart the server.",
  };
  return NextResponse.json(status);
}
