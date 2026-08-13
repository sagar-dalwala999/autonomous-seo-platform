"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";

/** Native form POST to /auth/signout (session cookie cleared server-side, then redirected to
 *  /login) — the only sign-out affordance in the authenticated shell; round-2 QA found the route
 *  existed but nothing in the UI called it. Real <button>, so Tab/Enter/Space all work natively. */
export function SignOutItem() {
  const [pending, setPending] = useState(false);

  return (
    <form action="/auth/signout" method="POST" onSubmit={() => setPending(true)}>
      <button
        type="submit"
        disabled={pending}
        className="flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-sm text-secondary outline-none transition-colors duration-150 hover:bg-subtle hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50"
      >
        <LogOut size={16} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
        {pending ? "Signing out…" : "Sign out"}
      </button>
    </form>
  );
}
