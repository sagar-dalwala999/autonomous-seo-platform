import { LayoutGrid, History, FileText, AlertTriangle, Map, ShieldAlert, GitCompare, ListTodo, Link2, ImageIcon, GitBranch, Activity, Gauge, Bot, type LucideIcon } from "lucide-react";

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

// Ordered to match how the tool is actually used: pick/start a run, review what it found,
// drill into the pages behind a finding, then compare or trace history (owner-directed regroup —
// previously one flat 8-item "Crawl data" bucket mixed findings, page drill-downs, and crawler-
// directive info with no structure).
export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Start here",
    items: [
      { href: "/", label: "Overview", icon: LayoutGrid },
      { href: "/runs", label: "Runs", icon: History, badgeKey: "runs" },
      { href: "/queue", label: "Crawl queue", icon: ListTodo },
    ],
  },
  {
    label: "Findings",
    items: [
      { href: "/issues", label: "Issues", icon: ShieldAlert },
      { href: "/failures", label: "Failures & Blocked", icon: AlertTriangle },
      { href: "/sitemap", label: "Sitemap & Robots", icon: Map },
      { href: "/sitefiles", label: "What the site tells crawlers", icon: Bot },
    ],
  },
  {
    label: "Explore pages",
    items: [
      { href: "/pages", label: "Pages", icon: FileText },
      { href: "/measurements", label: "All Measurements", icon: Gauge },
      { href: "/links", label: "Links", icon: Link2 },
      { href: "/images", label: "Images", icon: ImageIcon },
      { href: "/redirects", label: "Redirects", icon: GitBranch },
    ],
  },
  {
    label: "Compare & history",
    items: [
      { href: "/compare", label: "Compare", icon: GitCompare },
      { href: "/activity", label: "Activity", icon: Activity },
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
  { test: (p) => p === "/compare", title: "Compare" },
  { test: (p) => p === "/activity", title: "Activity" },
  { test: (p) => p === "/measurements", title: "All Measurements" },
  { test: (p) => p === "/sitefiles", title: "What the site tells crawlers" },
  { test: (p) => p === "/queue", title: "Crawl queue" },
  { test: (p) => p === "/links", title: "Links" },
  { test: (p) => p === "/images", title: "Images" },
  { test: (p) => p === "/redirects", title: "Redirects" },
];

export function titleForPath(pathname: string): string {
  return ROUTE_TITLES.find((r) => r.test(pathname))?.title ?? "SEO Platform";
}

// Hidden where a single "current run" is meaningless: /new-crawl has no run yet, /runs IS the
// run list, /compare drives its own base/head pair via RunPairSelector.
const RUN_SELECTOR_HIDDEN_ON = new Set(["/new-crawl", "/runs", "/compare", "/queue"]);

export function showRunSelectorFor(pathname: string): boolean {
  return !RUN_SELECTOR_HIDDEN_ON.has(pathname);
}
