import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/auth-middleware";
import { safeNextPath } from "@/lib/safe-next-path";

// Next.js 16 renamed `middleware.ts`/`middleware` to `proxy.ts`/`proxy` (functionally identical) —
// see node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md. This file IS the auth gate.
//
// Default-deny: anything not explicitly listed here requires a valid session. A new route added
// later is protected automatically — it must opt out by name, never the reverse.
const PUBLIC_EXACT_PATHS = new Set(["/api/health", "/api/ready", "/api/version", "/api/gsc/callback"]);
const PUBLIC_PREFIXES = ["/login", "/signup", "/auth"];
// Signed-in visitors get bounced off these back into the app. /auth/* is deliberately excluded —
// the callback and signout routes must stay reachable while authenticated, or sign-out breaks.
const AUTH_ONLY_PREFIXES = ["/login", "/signup"];

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isAuthOnlyPage(pathname: string): boolean {
  return AUTH_ONLY_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

// updateSession() may have refreshed the auth cookies onto its own `response`. A brand-new
// NextResponse (redirect/json) never receives those unless copied over by hand — the classic
// @supabase/ssr proxy pitfall where a token refreshed mid-request gets silently dropped on any
// response that isn't the exact object updateSession returned.
function withRefreshedCookies(target: NextResponse, source: NextResponse): NextResponse {
  source.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
  return target;
}

export async function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  const { response, claims } = await updateSession(request);

  if (isPublic(pathname)) {
    if (claims && isAuthOnlyPage(pathname)) {
      const target = new URL(safeNextPath(searchParams.get("next"), request.url), request.url);
      return withRefreshedCookies(NextResponse.redirect(target), response);
    }
    return response;
  }

  if (!claims) {
    if (pathname.startsWith("/api/")) {
      return withRefreshedCookies(NextResponse.json({ error: "Unauthorized" }, { status: 401 }), response);
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return withRefreshedCookies(NextResponse.redirect(loginUrl), response);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
