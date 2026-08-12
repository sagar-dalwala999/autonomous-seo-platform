"use client";

import { usePathname } from "next/navigation";
import { titleForPath } from "./nav-config";
import { useTopbarActions } from "@/lib/topbar-actions-context";

export function Topbar() {
  const pathname = usePathname();
  const { actions } = useTopbarActions();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
      <h1 className="text-base font-semibold text-foreground">{titleForPath(pathname)}</h1>
      <div className="flex items-center gap-2">{actions}</div>
    </header>
  );
}
