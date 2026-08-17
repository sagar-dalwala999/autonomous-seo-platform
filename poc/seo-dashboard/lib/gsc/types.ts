/**
 * Shared types for the Google Search Console integration.
 *
 * The dashboard has no database — every GSC payload is stored as flat JSON
 * under `storage/gsc/<userId>/` (see lib/gsc/storage.ts), scoped per Supabase
 * user and per site domain. These types describe both the stored shapes and
 * the API responses the /gsc UI consumes.
 */

/** A site (domain) the dashboard knows about, derived from crawl run start URLs. */
export interface GscSite {
  domain: string;
  /** The newest run's start URL for this domain, used as the crawl seed. */
  startUrl: string | null;
  runCount: number;
  lastCrawledAt: string | null;
  /** The Search Console property linked to this domain, if any. */
  linkedSiteUrl: string | null;
}

/** One Google account connection, per user. Tokens are stored encrypted. */
export interface GscConnection {
  userId: string;
  googleEmail: string | null;
  /** AES-256-GCM ciphertext — never the raw refresh token. */
  refreshTokenEnc: string;
  /** Short-lived access token, cached to avoid a refresh round-trip per call. */
  accessToken: string | null;
  accessTokenExpiresAt: string | null;
  scopes: string;
  createdAt: string;
  updatedAt: string;
}

/** Public view of a connection (never exposes tokens). */
export interface GscConnectionPublic {
  id: string;
  googleEmail: string | null;
  scopes: string;
  createdAt: string;
}

export interface GscStatus {
  /** Whether the server has GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET at all. */
  configured: boolean;
  connected: boolean;
  connection: GscConnectionPublic | null;
  setupHint: string | null;
}

export interface GscProperty {
  siteUrl: string;
  permissionLevel: string;
  propertyType: "domain" | "url_prefix";
  /** False for `siteUnverifiedUser` — listed by Google but returns no data. */
  canReadData: boolean;
  /** Domain this property is currently linked to (if any). */
  linkedDomain: string | null;
  /** Domains whose crawl start URL matches this property, for the picker. */
  suggestedDomains: string[];
}

/** A property linked to one of the dashboard's sites. Stored per (user, domain). */
export interface GscLinkedProperty {
  domain: string;
  siteUrl: string;
  propertyType: "domain" | "url_prefix";
  permissionLevel: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
}

export interface GscSyncResult {
  siteUrl: string;
  startDate: string;
  endDate: string;
  rowsFetched: number;
  rowsWritten: number;
  pages: number;
  totalClicks: number;
  totalImpressions: number;
  breakdowns: Record<string, number>;
}

/** One stored page-metric row (per day, per page, per search type). */
export interface GscPageMetricRow {
  date: string;
  pageUrl: string;
  normalizedUrl: string | null;
  searchType: "web" | "image";
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/** One stored breakdown row (per window, per dimension). */
export interface GscBreakdownRow {
  dimension: "query" | "device" | "country" | "searchAppearance";
  searchType: "web" | "image";
  keyValue: string;
  windowStart: string;
  windowEnd: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscDateRange {
  startDate: string;
  endDate: string;
  latestAvailable: string;
  provisionalStart: string;
  clampedReason: string | null;
}

export type GscVerdict = "PASS" | "PARTIAL" | "FAIL" | "NEUTRAL" | "VERDICT_UNSPECIFIED";

export interface GscInspection {
  pageUrl: string;
  verdict: GscVerdict;
  coverageState: string | null;
  robotsTxtState: string | null;
  indexingState: string | null;
  pageFetchState: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
  lastCrawlTime: string | null;
  crawledAs: string | null;
  sitemaps: string[] | null;
  raw: Record<string, unknown> | null;
  inspectedAt: string;
}

export interface GscInspectionRunResult {
  inspected: number;
  failed: number;
  remaining: number;
  quotaUsedToday: number;
  quotaRemainingToday: number;
  stoppedReason: string | null;
  quotaDisagreement: boolean;
  byVerdict: Record<string, number>;
}

/** One URL Inspection API call, for quota metering (successful or not). */
export interface GscInspectionAttempt {
  date: string;
  succeeded: boolean;
}
