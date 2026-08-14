import "server-only";
import "@/lib/auth-service-role-guard";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Refreshes the Supabase session cookie for `request` and returns the verified claims (or null).
 *  Used by proxy.ts. Uses getClaims(), never getSession() — getSession() only reads the cookie's
 *  cached value; it does not prove the token is still valid. getClaims() verifies the JWT
 *  signature (this project signs with a symmetric secret, so the SDK transparently falls back to
 *  a real round trip to the Auth server — see @supabase/auth-js GoTrueClient.getClaims). */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();

  return { response, claims: data?.claims ?? null };
}
