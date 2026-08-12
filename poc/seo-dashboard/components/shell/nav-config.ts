import { LayoutGrid, History, FileText, AlertTriangle, Map, ShieldAlert, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badgeKey?: "runs";
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Essentials",
    items: [
      { href: "/", label: "Overview", icon: LayoutGrid },
      { href: "/runs", label: "Runs", icon: History, badgeKey: "runs" },
    ],
  },
  {
    label: "Crawl data",
    items: [
      { href: "/pages", label: "Pages", icon: FileText },
      { href: "/failures", label: "Failures & Blocked", icon: AlertTriangle },
      { href: "/sitemap", label: "Sitemap & Robots", icon: Map },
      { href: "/issues", label: "Issues", icon: ShieldAlert },
    ],
  },
];

export const ROUTE_TITLES: { test: (path: string) => boolean; title: string }[] = [
  { test: (p) => p === "/", title: "Overview" },
  { test: (p) => p === "/runs", title: "Runs" },
  { test: (p) => p.startsWith("/pages/"), title: "Page detail" },
  { test: (p) => p === "/pages", title: "Pages" },
  { test: (p) => p === "/failures", title: "Failures & Blocked" },
  { test: (p) => p === "/sitemap", title: "Sitemap & Robots" },
  { test: (p) => p === "/issues", title: "Issues" },
];

export function titleForPath(pathname: string): string {
  return ROUTE_TITLES.find((r) => r.test(pathname))?.title ?? "SEO Platform";
}
