"use client";

import { usePathname } from "next/navigation";
import { titleForPath, showRunSelectorFor } from "./nav-config";
import { RunSelector } from "./run-selector";
import { useTopbarActions } from "@/lib/topbar-actions-context";
import type { RunListItem } from "@/lib/data";

export function Topbar({ runs }: { runs: RunListItem[] }) {
  const pathname = usePathname();
  const { actions } = useTopbarActions();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
      <h1 className="text-base font-semibold text-foreground">{titleForPath(pathname)}</h1>
      <div className="flex items-center gap-2">
        {runs.length > 0 && showRunSelectorFor(pathname) && <RunSelector runs={runs} />}
        {actions}
      </div>
    </header>
  );
}
