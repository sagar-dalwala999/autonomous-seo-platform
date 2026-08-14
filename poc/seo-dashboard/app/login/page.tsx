import { createClient } from "@/lib/auth-server";
import { LoginForm } from "@/components/auth/LoginForm";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { AuthVisual } from "@/components/auth/AuthVisual";
import { safeNextPath } from "@/lib/safe-next-path";

// Reads the session cookie on every request — a prerendered/stale "signed out" page would be a
// real auth bug (it could show the login form to an already-authenticated visitor, or vice versa).
export const dynamic = "force-dynamic";

// No request URL available in a Server Component, so this resolves `next` against a fixed
// placeholder origin (.invalid is reserved by RFC 2606, never a real host) — safeNextPath only
// needs *some* origin to detect an off-origin escape; which one doesn't matter since only the
// resolved path (never the origin itself) is used here.
const PLACEHOLDER_BASE = "http://same-origin.invalid";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const nextPath = safeNextPath(next, PLACEHOLDER_BASE);

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  const rightPanel = data?.claims ? (
    <div className="w-full max-w-[368px] text-center">
      <p className="text-sm text-foreground">
        Signed in{typeof data.claims.email === "string" ? ` as ${data.claims.email}` : ""}.
      </p>
      <div className="mt-5 flex flex-col gap-2">
        <a
          href={nextPath}
          className="inline-flex h-11 items-center justify-center rounded-control bg-primary px-3.5 text-sm font-medium text-primary-contrast transition hover:brightness-110"
        >
          Continue
        </a>
        <SignOutButton />
      </div>
    </div>
  ) : (
    <LoginForm nextPath={nextPath} />
  );

  return (
    <div className="flex h-full min-h-0 w-full">
      <div className="hidden shrink-0 lg:block lg:w-[46%] xl:w-[42%]">
        <AuthVisual />
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto bg-canvas px-6 py-10 sm:px-10">
        {rightPanel}
      </div>
    </div>
  );
}
