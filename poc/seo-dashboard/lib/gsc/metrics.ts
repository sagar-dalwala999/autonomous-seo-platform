/**
 * Builds the metrics response for a linked domain from the JSON store.
 *
 * This is the read side of the /api/gsc/metrics/:domain endpoint: it filters
 * stored page metrics to the requested window, computes totals + daily trend,
 * slices breakdowns, and attaches the stored URL-inspection rows + rollup.
 * All in memory — a 28-day window of a typical site is a few thousand rows,
 * which is trivially fast and needs no query engine.
 */
import { readMetrics, readInspections } from "./storage";
import type {
  GscPageMetricRow,
  GscBreakdownRow,
  GscInspection,
  GscVerdict,
  GscDateRange,
} from "./types";
import type { ResolvedRange } from "./date-range";
import { latestUsableDate, provisionalStartDate } from "./date-range";

export interface GscTotals {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  pages: number;
  firstDate: string | null;
  lastDate: string | null;
}

export interface GscMetricsResponse {
  property: { siteUrl: string; propertyType: string; lastSyncedAt: string | null };
  range: GscDateRange;
  searchType: "web" | "image";
  fetchedLive: boolean;
  partial: boolean;
  totals: GscTotals | null;
  trend: Array<{ date: string; clicks: number; impressions: number }>;
  pages: Array<{
    pageUrl: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
    days: number;
  }>;
  queries: GscBreakdownRow[];
  devices: GscBreakdownRow[];
  countries: GscBreakdownRow[];
  searchAppearances: GscBreakdownRow[];
  inspections: GscInspection[];
  coverage: Array<{ verdict: GscVerdict; coverageState: string | null; count: number }>;
}

export async function getMetricsResponse(
  userId: string,
  domain: string,
  siteUrl: string,
  propertyType: string,
  lastSyncedAt: string | null,
  range: ResolvedRange,
  searchType: "web" | "image",
  coverage: { fetched: boolean; failed?: boolean },
): Promise<GscMetricsResponse> {
  const metrics = await readMetrics(userId, domain);
  const inspections = await readInspections(userId, domain);

  const inWindow = (r: GscPageMetricRow) =>
    r.searchType === searchType && r.date >= range.startDate && r.date <= range.endDate;
  const rows = (metrics?.pageMetrics ?? []).filter(inWindow);

  // Per-page totals, best-performing first.
  const byUrl = new Map<string, { pageUrl: string; clicks: number; impressions: number; ctr: number; position: number; days: number }>();
  for (const r of rows) {
    const cur = byUrl.get(r.pageUrl);
    if (!cur) {
      byUrl.set(r.pageUrl, {
        pageUrl: r.pageUrl,
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: r.ctr,
        position: r.position,
        days: 1,
      });
      continue;
    }
    cur.clicks += r.clicks;
    cur.impressions += r.impressions;
    cur.days += 1;
    cur.ctr = cur.impressions > 0 ? cur.clicks / cur.impressions : 0;
    cur.position = cur.impressions > 0 ? (cur.position * (cur.impressions - r.impressions) + r.position * r.impressions) / cur.impressions : 0;
  }
  const pages = [...byUrl.values()].sort((a, b) => b.impressions - a.impressions).slice(0, 1000);

  // Daily totals for the trend line.
  const byDate = new Map<string, { date: string; clicks: number; impressions: number }>();
  for (const r of rows) {
    const cur = byDate.get(r.date);
    if (cur) {
      cur.clicks += r.clicks;
      cur.impressions += r.impressions;
    } else {
      byDate.set(r.date, { date: r.date, clicks: r.clicks, impressions: r.impressions });
    }
  }
  const trend = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

  let clicks = 0;
  let impressions = 0;
  for (const r of rows) {
    clicks += r.clicks;
    impressions += r.impressions;
  }
  const totals: GscTotals | null = impressions === 0 && rows.length === 0
    ? null
    : {
        clicks: Math.round(clicks),
        impressions: Math.round(impressions),
        ctr: impressions > 0 ? clicks / impressions : 0,
        position: impressions > 0
          ? rows.reduce((acc, r) => acc + r.position * r.impressions, 0) / impressions
          : 0,
        pages: byUrl.size,
        firstDate: rows.length > 0 ? rows.reduce((a, b) => (a.date < b.date ? a : b)).date : null,
        lastDate: rows.length > 0 ? rows.reduce((a, b) => (a.date > b.date ? a : b)).date : null,
      };

  const windowBreakdowns = (dimension: GscBreakdownRow["dimension"]) =>
    (metrics?.breakdowns ?? [])
      .filter(
        (b) =>
          b.dimension === dimension &&
          b.searchType === searchType &&
          b.windowStart === range.startDate &&
          b.windowEnd === range.endDate,
      )
      .sort((a, b) => b.impressions - a.impressions);

  const inspRows = inspections?.rows ?? [];
  const coverageRollup = new Map<string, { verdict: GscVerdict; coverageState: string | null; count: number }>();
  for (const i of inspRows) {
    const k = `${i.verdict}|${i.coverageState ?? ""}`;
    const cur = coverageRollup.get(k);
    if (cur) cur.count += 1;
    else coverageRollup.set(k, { verdict: i.verdict, coverageState: i.coverageState, count: 1 });
  }

  return {
    property: { siteUrl, propertyType, lastSyncedAt },
    range: {
      ...range,
      latestAvailable: latestUsableDate(),
      provisionalStart: provisionalStartDate(range.endDate),
    },
    searchType,
    fetchedLive: coverage.fetched,
    partial: Boolean(coverage.failed),
    totals,
    trend,
    pages,
    queries: windowBreakdowns("query"),
    devices: windowBreakdowns("device"),
    countries: windowBreakdowns("country"),
    searchAppearances: windowBreakdowns("searchAppearance"),
    inspections: inspRows.sort((a, b) => {
      const order: Record<string, number> = { FAIL: 0, NEUTRAL: 1, PARTIAL: 2, PASS: 3, VERDICT_UNSPECIFIED: 4 };
      return (order[a.verdict] ?? 5) - (order[b.verdict] ?? 5);
    }),
    coverage: [...coverageRollup.values()].sort((a, b) => b.count - a.count),
  };
}
