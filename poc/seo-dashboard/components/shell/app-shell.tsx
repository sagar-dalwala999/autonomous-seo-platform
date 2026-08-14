"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Menu, PanelLeftOpen } from "lucide-react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { CommandPalette } from "./command-palette";
import { NAV_SECTIONS } from "./nav-config";
import { SlideOver } from "@/components/ui/slide-over";
import { readStoredCollapsed, writeStoredCollapsed } from "@/lib/sidebar-collapse";
import { pickDefaultRun } from "@/lib/run-selection";
import { cn } from "@/lib/cn";
import type { RunListItem } from "@/lib/data";

interface Props {
  runs: RunListItem[];
  runCount: number;
  reportPath: string;
  children: ReactNode;
}

export function AppShell({ runs, runCount, reportPath, children }: Props) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // SSR/first paint always renders expanded (matches ThemeToggle's own "correct after mount"
  // trade-off already accepted in this codebase) — corrected from localStorage on mount below.
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const allItems = NAV_SECTIONS.flatMap((s) => s.items);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate post-mount upgrade from the SSR-safe "expanded" default above, not derivable at render time (same pattern as components/preview/page-replay.tsx)
    setCollapsed(readStoredCollapsed());
  }, []);

  function toggleCollapsed(next: boolean) {
    setCollapsed(next);
    writeStoredCollapsed(next);
  }

  // Carries the selected run across nav (icon rails) — destination pages fall back to latest on
  // an absent/invalid ?run= (lib/data.ts resolveRunId), so this is safe to forward as-is.
  const run = searchParams.get("run");
  // Effective run for the command palette's rule index: same rule as the RunSelector (valid ?run=
  // wins, otherwise the newest substantial run) so the palette always has a run to fetch rules for.
  const currentRun = (run && runs.find((r) => r.runId === run)) || pickDefaultRun(runs);
  const withRun = (href: string) => (run ? `${href}?run=${encodeURIComponent(run)}` : href);

  function iconLink(item: (typeof allItems)[number]) {
    const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={withRun(item.href)}
        aria-label={item.label}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-control outline-none focus-visible:ring-2 focus-visible:ring-primary",
          active ? "bg-elevated text-foreground shadow-[inset_2px_0_0_0_var(--primary)]" : "text-secondary hover:bg-subtle",
        )}
      >
        <Icon size={18} strokeWidth={1.75} />
      </Link>
    );
  }

  return (
    // grid-rows-[minmax(0,1fr)]: without it the implicit row grows past h-dvh with tall content,
    // main's overflow-y-auto never engages, and the overflow-hidden body makes the app unscrollable.
    <div
      className={cn(
        "grid h-dvh w-full grid-rows-[minmax(0,1fr)] transition-[grid-template-columns] duration-200",
        collapsed ? "grid-cols-[64px_1fr]" : "grid-cols-[64px_1fr] lg:grid-cols-[264px_1fr]",
      )}
    >
      {/* Sidebar preserves ?run= itself via its own useSearchParams — see components/shell/sidebar.tsx. */}
      <aside className={cn("min-h-0 flex-col overflow-y-auto border-r border-border bg-card", collapsed ? "hidden" : "hidden lg:flex")}>
        <Sidebar runCount={runCount} reportPath={reportPath} onCollapse={() => toggleCollapsed(true)} />
      </aside>

      {/* Desktop collapsed rail — user-toggled, independent of the mobile rail below. */}
      {collapsed && (
        <aside className="hidden min-h-0 flex-col items-center gap-1 overflow-y-auto border-r border-border bg-card py-4 lg:flex">
          <button
            type="button"
            onClick={() => toggleCollapsed(false)}
            aria-label="Expand sidebar"
            className="mb-2 flex h-9 w-9 items-center justify-center rounded-control text-secondary outline-none hover:bg-subtle focus-visible:ring-2 focus-visible:ring-primary"
          >
            <PanelLeftOpen size={18} strokeWidth={1.75} />
          </button>
          {allItems.map(iconLink)}
        </aside>
      )}

      {/* Mobile rail — always icon-only below lg, independent of the desktop collapse toggle. */}
      <aside className="flex min-h-0 flex-col items-center gap-1 overflow-y-auto border-r border-border bg-card py-4 lg:hidden">
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open navigation"
          className="mb-2 flex h-9 w-9 items-center justify-center rounded-control text-secondary outline-none hover:bg-subtle focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Menu size={18} strokeWidth={1.75} />
        </button>
        {allItems.map(iconLink)}
      </aside>

      <SlideOver
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        title="Navigation"
        side="left"
        widthClassName="w-[280px]"
        bodyClassName=""
      >
        <Sidebar runCount={runCount} reportPath={reportPath} onNavigate={() => setMobileNavOpen(false)} />
      </SlideOver>

      <div className="flex min-h-0 min-w-0 flex-col">
        <Topbar runs={runs} />
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-6">{children}</main>
      </div>

      <CommandPalette runs={runs} runId={currentRun?.runId ?? null} />
    </div>
  );
}
