import { createBrowserClient } from "@supabase/ssr";

/** Anon/publishable key only — safe for the browser bundle. Never import the service-role key here. */
export function createClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
