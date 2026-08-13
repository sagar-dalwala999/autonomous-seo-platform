"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Radar, PanelLeftClose } from "lucide-react";
import { NAV_SECTIONS } from "./nav-config";
import { SearchInput } from "./search-input";
import { HelpItem } from "./help-item";
import { SignOutItem } from "./sign-out-item";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/cn";

interface Props {
  runCount: number;
  reportPath: string;
  onNavigate?: () => void;
  onCollapse?: () => void;
}

export function Sidebar({ runCount, reportPath, onNavigate, onCollapse }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Forwards the selected run across sections; destination pages fall back to latest on an
  // absent/invalid ?run= (lib/data.ts resolveRunId), so this is safe to forward as-is.
  const run = searchParams.get("run");
  const withRun = (href: string) => (run ? `${href}?run=${encodeURIComponent(run)}` : href);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-4 pb-4 pt-5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-primary text-primary-contrast">
          <Radar size={18} strokeWidth={1.75} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">SEO Platform</p>
          <p className="truncate text-xs text-faint">Crawler POC</p>
        </div>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Collapse sidebar"
            className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-control text-faint outline-none hover:bg-subtle hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary lg:flex"
          >
            <PanelLeftClose size={15} strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="px-4 pb-3">
        <SearchInput />
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="mb-4">
            <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">{section.label}</p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={withRun(item.href)}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-control px-2.5 py-2 text-sm outline-none transition-colors duration-150",
                        "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card",
                        active
                          ? "bg-elevated font-semibold text-primary"
                          : "font-medium text-secondary hover:bg-subtle hover:text-foreground",
                      )}
                    >
                      {/* Accent lives on the icon, not a rail: a full-height inset bar sat outside
                          the item's rounded fill and read as a stray line detached from its row. */}
                      <Icon
                        size={16}
                        strokeWidth={active ? 2.25 : 1.75}
                        className={active ? "text-primary" : undefined}
                        aria-hidden="true"
                      />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.badgeKey === "runs" && (
                        <span className="rounded-pill border border-border bg-elevated px-1.5 text-[11px] tabular-nums text-secondary">
                          {runCount}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="space-y-3 border-t border-border px-4 py-4">
        <div>
          <p className="px-0.5 pb-1.5 text-[11px] font-medium text-faint">Account</p>
          <ThemeToggle />
        </div>
        <SignOutItem />
        <HelpItem reportPath={reportPath} />
        <div className="flex items-center gap-2 px-0.5 pt-1 text-xs text-faint">
          <span className="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden="true" />
          Crawler POC · local
        </div>
      </div>
    </div>
  );
}
