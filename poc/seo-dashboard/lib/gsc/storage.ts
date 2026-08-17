/**
 * Persistence for the Search Console integration.
 *
 * Postgres-first, JSON-file fallback. Reads and writes go through the shared
 * `@seo-platform/db` Prisma layer (packages/db) keyed by the Supabase user id,
 * mirroring the JSON store it replaces. The backend is resolved once on first
 * use:
 *
 *  - If the DB module loads and connects (DATABASE_URL in packages/db/.env),
 *    Postgres is used for everything. A query error then surfaces — that's how
 *    you find out the GSC tables haven't been migrated yet.
 *  - If the DB is unavailable (no .env, unreachable, or GSC_DB_ENABLED=false),
 *    it degrades to the old flat-JSON files under `storage/gsc/<userId>/` with
 *    a single logged warning — the POC never hard-crashes.
 *
 * Loading is the same runtime-computed dynamic import the crawler uses for
 * packages/db (zero build-time coupling, no npm dependency), and every query
 * filters by userId so one user can never read another's Google data.
 *
 * Server-only: uses node:fs and node:crypto. Never import from a "use client" file.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { GSC_STORAGE_ROOT } from "./crypto";
import type {
  GscConnection,
  GscLinkedProperty,
  GscPageMetricRow,
  GscBreakdownRow,
  GscInspection,
  GscInspectionAttempt,
} from "./types";

// ---------------------------------------------------------------------------
// Postgres adapter (packages/db) — lazy, resolved once
// ---------------------------------------------------------------------------

type DbModule = {
  loadEnv: () => void;
  createPrismaClient: (profile: string) => PrismaLike;
  gscReadConnection: (p: PrismaLike, userId: string) => Promise<GscConnection | null>;
  gscWriteConnection: (p: PrismaLike, conn: GscConnection) => Promise<void>;
  gscDeleteConnection: (p: PrismaLike, userId: string) => Promise<void>;
  gscReadLinkedProperty: (p: PrismaLike, userId: string, domain: string) => Promise<(GscLinkedProperty & { userId: string }) | null>;
  gscWriteLinkedProperty: (p: PrismaLike, property: GscLinkedProperty & { userId: string }) => Promise<void>;
  gscDeleteLinkedProperty: (p: PrismaLike, userId: string, domain: string) => Promise<void>;
  gscListLinkedDomains: (p: PrismaLike, userId: string) => Promise<string[]>;
  gscReadMetrics: (p: PrismaLike, userId: string, domain: string) => Promise<StoredMetrics | null>;
  gscWriteMetrics: (p: PrismaLike, userId: string, domain: string, bundle: StoredMetrics) => Promise<void>;
  gscReadInspections: (p: PrismaLike, userId: string, domain: string) => Promise<StoredInspections | null>;
  gscWriteInspections: (p: PrismaLike, userId: string, domain: string, bundle: StoredInspections) => Promise<void>;
};

type PrismaLike = { $queryRaw: (q: unknown) => Promise<unknown> };

let dbModule: DbModule | null = null;
let prisma: PrismaLike | null = null;
/** "db" | "json" | null (not resolved yet). */
let backend: "db" | "json" | null = null;
let warned = false;

/** Absolute path to packages/db/dist/index.js from this app's cwd. */
function dbDistPath(): string {
  return path.resolve(process.cwd(), "..", "..", "packages", "db", "dist", "index.js");
}

async function ensureDb(): Promise<boolean> {
  if (backend) return backend === "db";
  if (process.env.GSC_DB_ENABLED === "false") {
    backend = "json";
    return false;
  }
  try {
    const distPath = dbDistPath();
    const url = new URL(`file:///${distPath.replace(/\\/g, "/")}`).href;
    const mod = (await import(url)) as DbModule;
    mod.loadEnv();
    const client = mod.createPrismaClient("api");
    await client.$queryRaw`SELECT 1`;
    dbModule = mod;
    prisma = client;
    backend = "db";
    return true;
  } catch (err) {
    if (!warned) {
      console.warn(
        "[gsc] Postgres unavailable — using JSON storage under storage/gsc/. " +
          "To use the database: apply the GSC migration (`npm run migrate:deploy` in packages/db) and ensure DATABASE_URL is set there. " +
          `(${err instanceof Error ? err.message : String(err)})`,
      );
      warned = true;
    }
    backend = "json";
    return false;
  }
}

/** Returns the resolved Prisma client, or null when the JSON backend is active. */
async function db(): Promise<PrismaLike | null> {
  return (await ensureDb()) ? prisma : null;
}

// ---------------------------------------------------------------------------
// Flat-JSON fallback
// ---------------------------------------------------------------------------

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

/** The per-user root: storage/gsc/<userId>/. */
export function userDir(userId: string): string {
  return path.join(GSC_STORAGE_ROOT, userId);
}

/** Per-(user, domain) data dir. `domain` is a normalised hostname. */
export function domainDir(userId: string, domain: string): string {
  return path.join(userDir(userId), domain);
}

function connectionPath(userId: string): string {
  return path.join(userDir(userId), "connection.json");
}

function propertyPath(userId: string, domain: string): string {
  return path.join(domainDir(userId, domain), "property.json");
}

function metricsPath(userId: string, domain: string): string {
  return path.join(domainDir(userId, domain), "metrics.json");
}

function inspectionsPath(userId: string, domain: string): string {
  return path.join(domainDir(userId, domain), "inspections.json");
}

/** Normalise a domain for use as a directory/file key. */
export function domainKey(domain: string): string {
  const normalized = domain.trim().toLowerCase().replace(/^www\./i, "").replace(/:\d+$/, "");
  // Guard against path traversal via a crafted domain.
  return normalized.replace(/[^a-z0-9._-]/g, "-") || "unknown";
}

export interface StoredMetrics {
  siteUrl: string;
  propertyType: "domain" | "url_prefix";
  lastSyncedAt: string | null;
  pageMetrics: GscPageMetricRow[];
  breakdowns: GscBreakdownRow[];
}

export interface StoredInspections {
  rows: GscInspection[];
  /** One entry per API call (successful or not) — the quota meter. */
  attempts: GscInspectionAttempt[];
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

export async function readConnection(userId: string): Promise<GscConnection | null> {
  const client = await db();
  if (client) return dbModule!.gscReadConnection(client, userId);
  return readJson<GscConnection>(connectionPath(userId));
}

export async function writeConnection(connection: GscConnection): Promise<void> {
  const client = await db();
  if (client) return dbModule!.gscWriteConnection(client, connection);
  await writeJson(connectionPath(connection.userId), connection);
}

export async function deleteConnection(userId: string): Promise<void> {
  const client = await db();
  if (client) return dbModule!.gscDeleteConnection(client, userId);
  const { rm } = await import("node:fs/promises");
  await rm(connectionPath(userId), { force: true });
}

// ---------------------------------------------------------------------------
// Linked property (one per domain)
// ---------------------------------------------------------------------------

export async function readLinkedProperty(userId: string, domain: string): Promise<GscLinkedProperty | null> {
  const client = await db();
  if (client) {
    const row = await dbModule!.gscReadLinkedProperty(client, userId, domainKey(domain));
    if (!row) return null;
    // The stored row carries userId; the dashboard's type keeps it implicit.
    return {
      domain: row.domain,
      siteUrl: row.siteUrl,
      propertyType: row.propertyType,
      permissionLevel: row.permissionLevel,
      lastSyncedAt: row.lastSyncedAt,
      createdAt: row.createdAt,
    };
  }
  return readJson<GscLinkedProperty>(propertyPath(userId, domainKey(domain)));
}

export async function writeLinkedProperty(userId: string, property: GscLinkedProperty): Promise<void> {
  const client = await db();
  if (client) return dbModule!.gscWriteLinkedProperty(client, { userId, ...property });
  await writeJson(propertyPath(userId, domainKey(property.domain)), property);
}

export async function deleteLinkedProperty(userId: string, domain: string): Promise<void> {
  const client = await db();
  if (client) return dbModule!.gscDeleteLinkedProperty(client, userId, domainKey(domain));
  const { rm } = await import("node:fs/promises");
  await rm(propertyPath(userId, domainKey(domain)), { force: true });
}

/** Every domain this user has linked a property to. */
export async function listLinkedDomains(userId: string): Promise<string[]> {
  const client = await db();
  if (client) return dbModule!.gscListLinkedDomains(client, userId);
  try {
    const entries = await readdir(userDir(userId), { withFileTypes: true });
    const domains: string[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const prop = await readLinkedProperty(userId, e.name);
      if (prop) domains.push(e.name);
    }
    return domains.sort();
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Metrics (page metrics + breakdowns, per search type)
// ---------------------------------------------------------------------------

export async function readMetrics(userId: string, domain: string): Promise<StoredMetrics | null> {
  const client = await db();
  if (client) return dbModule!.gscReadMetrics(client, userId, domainKey(domain));
  return readJson<StoredMetrics>(metricsPath(userId, domainKey(domain)));
}

export async function writeMetrics(userId: string, domain: string, metrics: StoredMetrics): Promise<void> {
  const client = await db();
  if (client) return dbModule!.gscWriteMetrics(client, userId, domainKey(domain), metrics);
  await writeJson(metricsPath(userId, domainKey(domain)), metrics);
}

// ---------------------------------------------------------------------------
// URL inspections
// ---------------------------------------------------------------------------

export async function readInspections(userId: string, domain: string): Promise<StoredInspections | null> {
  const client = await db();
  if (client) return dbModule!.gscReadInspections(client, userId, domainKey(domain));
  return readJson<StoredInspections>(inspectionsPath(userId, domainKey(domain)));
}

export async function writeInspections(userId: string, domain: string, data: StoredInspections): Promise<void> {
  const client = await db();
  if (client) return dbModule!.gscWriteInspections(client, userId, domainKey(domain), data);
  await writeJson(inspectionsPath(userId, domainKey(domain)), data);
}

// ---------------------------------------------------------------------------
// OAuth state secret (persisted so the callback can verify a signed state)
// ---------------------------------------------------------------------------

const STATE_SECRET_PATH = path.join(GSC_STORAGE_ROOT, ".state-secret");

/**
 * A stable per-install secret for signing the OAuth `state` parameter.
 *
 * Prefers GSC_STATE_SECRET when set; otherwise persists a random value on
 * first use so the callback can verify state without requiring new env
 * config. Persisting means the secret survives dev-server restarts (a fresh
 * random value each boot would invalidate every in-flight consent screen).
 */
export async function stateSecret(): Promise<string> {
  const explicit = process.env.GSC_STATE_SECRET?.trim();
  if (explicit) return explicit;
  const existing = await readJson<{ secret: string }>(STATE_SECRET_PATH);
  if (existing?.secret) return existing.secret;
  const { randomBytes } = await import("node:crypto");
  const secret = randomBytes(32).toString("base64url");
  await writeJson(STATE_SECRET_PATH, { secret });
  return secret;
}
