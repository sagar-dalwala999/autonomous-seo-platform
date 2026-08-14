import "server-only";
import "@/lib/auth-service-role-guard";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/** Server-side Supabase client for Server Components / Route Handlers. Create a fresh one per
 *  request — never module-level singleton (the SDK's docs are explicit about this for SSR). */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component render (cookies are read-only there) — proxy.ts is
          // what actually refreshes and persists the session cookie on every request.
        }
      },
    },
  });
}
