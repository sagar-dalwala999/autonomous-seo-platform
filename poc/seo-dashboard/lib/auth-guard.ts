import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/auth-server";

/** Route-handler-level re-check. proxy.ts already blocks unauthenticated requests, but Next.js
 *  proxy/middleware has had real bypass vulnerabilities (e.g. CVE-2025-29927's
 *  x-middleware-subrequest header trick), so every protected route verifies its own session too —
 *  a direct call must never be able to skip the network hop and reach the handler ungated. */
export async function requireApiSession(): Promise<{ claims: Record<string, unknown> } | { response: NextResponse }> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { claims: data.claims };
}
