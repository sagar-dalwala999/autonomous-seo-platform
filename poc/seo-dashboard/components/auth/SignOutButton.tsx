"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/auth-browser";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    setPending(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    // Server Components cache their render — refresh() re-runs them against the now-cleared cookie.
    router.refresh();
  }

  return (
    <Button type="button" variant="outline" disabled={pending} onClick={handleSignOut} className="w-full">
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
