import "server-only";

/** This app has no legitimate use for the service-role key — it bypasses RLS and is equivalent
 *  to full DB ownership. Nothing in this project should ever read SUPABASE_SERVICE_ROLE_KEY or a
 *  NEXT_PUBLIC_-prefixed variant of it; this is a tripwire so a future regression fails loudly
 *  instead of silently shipping the key into a client bundle. */
if (typeof window !== "undefined") {
  throw new Error("lib/auth-service-role-guard.ts was imported into client code. This must never happen.");
}
if (process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY is set. The service-role key must never carry a NEXT_PUBLIC_ prefix — " +
      "Next.js inlines NEXT_PUBLIC_* vars into the browser bundle, which would hand every visitor full DB access.",
  );
}

export function assertServiceRoleKeyNotExposed(): void {
  // No-op call site — importing this module is the guard. Kept as a function so route/lib code
  // can `import "@/lib/auth-service-role-guard"` (side-effect only) or call this explicitly.
}
