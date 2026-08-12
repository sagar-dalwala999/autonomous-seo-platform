"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { NAV_SECTIONS } from "./nav-config";
import { SlideOver } from "@/components/ui/slide-over";
import { cn } from "@/lib/cn";

interface Props {
  runCount: number;
  reportPath: string;
  children: ReactNode;
}

export function AppShell({ runCount, reportPath, children }: Props) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const pathname = usePathname();
  const allItems = NAV_SECTIONS.flatMap((s) => s.items);

  return (
    // grid-rows-[minmax(0,1fr)]: without it the implicit row grows past h-dvh with tall content,
    // main's overflow-y-auto never engages, and the overflow-hidden body makes the app unscrollable.
    <div className="grid h-dvh w-full grid-cols-[64px_1fr] grid-rows-[minmax(0,1fr)] lg:grid-cols-[264px_1fr]">
      <aside className="hidden min-h-0 flex-col overflow-y-auto border-r border-border bg-card lg:flex">
        <Sidebar runCount={runCount} reportPath={reportPath} />
      </aside>

      <aside className="flex min-h-0 flex-col items-center gap-1 overflow-y-auto border-r border-border bg-card py-4 lg:hidden">
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open navigation"
          className="mb-2 flex h-9 w-9 items-center justify-center rounded-control text-secondary outline-none hover:bg-subtle focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Menu size={18} strokeWidth={1.75} />
        </button>
        {allItems.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-control outline-none focus-visible:ring-2 focus-visible:ring-primary",
                active ? "border border-border bg-subtle text-foreground" : "text-secondary hover:bg-subtle",
              )}
            >
              <Icon size={18} strokeWidth={1.75} />
            </Link>
          );
        })}
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
        <Topbar />
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
