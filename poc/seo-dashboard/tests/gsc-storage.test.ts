import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

/**
 * Exercises the storage API's JSON fallback path in an isolated temp dir.
 * GSC_DB_ENABLED=false pins the backend to JSON (no DB import), and
 * GSC_STORAGE_DIR is set BEFORE the module import so the storage root resolves
 * into the temp dir. The DB path can't run without a live Postgres; this pins
 * that the public API and shapes still round-trip after the Postgres-first
 * rewrite.
 */
import type { GscLinkedProperty, GscInspection, GscPageMetricRow, GscBreakdownRow } from "../lib/gsc/types";

let dir: string;
let storage: typeof import("../lib/gsc/storage");

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "gsc-storage-test-"));
  process.env.GSC_STORAGE_DIR = dir;
  process.env.GSC_DB_ENABLED = "false";
  storage = await import("../lib/gsc/storage");
});

afterAll(async () => {
  delete process.env.GSC_STORAGE_DIR;
  delete process.env.GSC_DB_ENABLED;
  await rm(dir, { recursive: true, force: true });
});

const USER = "00000000-0000-4000-8000-000000000001";
const DOMAIN = "example.com";

describe("gsc storage (JSON fallback)", () => {
  it("round-trips a connection and deletes it", async () => {
    const conn = {
      userId: USER,
      googleEmail: "me@example.com",
      refreshTokenEnc: "iv.tag.cipher",
      accessToken: "ya29.abc",
      accessTokenExpiresAt: "2026-08-18T00:00:00.000Z",
      scopes: "openid email",
      createdAt: "2026-08-17T00:00:00.000Z",
      updatedAt: "2026-08-17T00:00:00.000Z",
    };
    await storage.writeConnection(conn);
    expect(await storage.readConnection(USER)).toEqual(conn);
    await storage.deleteConnection(USER);
    expect(await storage.readConnection(USER)).toBeNull();
  });

  it("round-trips a linked property and lists domains", async () => {
    const prop: GscLinkedProperty = {
      domain: DOMAIN,
      siteUrl: "sc-domain:example.com",
      propertyType: "domain",
      permissionLevel: "full",
      lastSyncedAt: "2026-08-17T00:00:00.000Z",
      createdAt: "2026-08-17T00:00:00.000Z",
    };
    await storage.writeLinkedProperty(USER, prop);
    expect(await storage.readLinkedProperty(USER, DOMAIN)).toEqual(prop);
    expect(await storage.listLinkedDomains(USER)).toEqual([DOMAIN]);
    await storage.deleteLinkedProperty(USER, DOMAIN);
    expect(await storage.readLinkedProperty(USER, DOMAIN)).toBeNull();
  });

  it("round-trips a metrics bundle", async () => {
    const pageMetrics: GscPageMetricRow[] = [
      { date: "2026-08-01", pageUrl: "https://example.com/", normalizedUrl: "https://example.com/", searchType: "web", clicks: 10, impressions: 100, ctr: 0.1, position: 3.2 },
      { date: "2026-08-02", pageUrl: "https://example.com/", normalizedUrl: "https://example.com/", searchType: "web", clicks: 12, impressions: 90, ctr: 0.13, position: 2.9 },
    ];
    const breakdowns: GscBreakdownRow[] = [
      { dimension: "query", searchType: "web", keyValue: "seo tool", windowStart: "2026-08-01", windowEnd: "2026-08-02", clicks: 22, impressions: 190, ctr: 0.12, position: 3.1 },
    ];
    const metrics = { siteUrl: "sc-domain:example.com", propertyType: "domain" as const, lastSyncedAt: "2026-08-17T00:00:00.000Z", pageMetrics, breakdowns };
    await storage.writeMetrics(USER, DOMAIN, metrics);
    expect(await storage.readMetrics(USER, DOMAIN)).toEqual(metrics);
  });

  it("round-trips an inspections bundle", async () => {
    const row: GscInspection = {
      pageUrl: "https://example.com/",
      verdict: "PASS",
      coverageState: "Submitted and indexed",
      robotsTxtState: null,
      indexingState: null,
      pageFetchState: null,
      googleCanonical: "https://example.com/",
      userCanonical: "https://example.com/",
      lastCrawlTime: "2026-08-10T00:00:00.000Z",
      crawledAs: null,
      sitemaps: null,
      raw: { note: "ok" },
      inspectedAt: "2026-08-17T00:00:00.000Z",
    };
    const inspections = { rows: [row], attempts: [{ date: "2026-08-17", succeeded: true }] };
    await storage.writeInspections(USER, DOMAIN, inspections);
    expect(await storage.readInspections(USER, DOMAIN)).toEqual(inspections);
  });

  it("returns a stable state secret", async () => {
    const a = await storage.stateSecret();
    const b = await storage.stateSecret();
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(20);
  });
});
