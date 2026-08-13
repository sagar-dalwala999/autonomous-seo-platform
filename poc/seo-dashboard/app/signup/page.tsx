import Link from "next/link";
import { createClient } from "@/lib/auth-server";
import { SignupForm } from "@/components/auth/SignupForm";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { AuthVisual } from "@/components/auth/AuthVisual";

// Reads the session cookie on every request — a prerendered/stale "signed out" page would be a
// real auth bug (it could show the signup form to an already-authenticated visitor).
export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  const rightPanel = data?.claims ? (
    <div className="w-full max-w-[368px] text-center">
      <p className="text-sm text-foreground">
        Signed in{typeof data.claims.email === "string" ? ` as ${data.claims.email}` : ""}.
      </p>
      <div className="mt-5 flex flex-col gap-2">
        <Link
          href="/"
          className="inline-flex h-11 items-center justify-center rounded-control bg-primary px-3.5 text-sm font-medium text-primary-contrast transition hover:brightness-110"
        >
          Continue
        </Link>
        <SignOutButton />
      </div>
    </div>
  ) : (
    <SignupForm />
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
