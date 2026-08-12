import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { CrawlScope, FetchArtifact } from "../../../src/models/types";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/html");

export function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), "utf-8");
}

export function makeArtifact(overrides: Partial<FetchArtifact> & { html: string }): FetchArtifact {
  return {
    url: "https://summittrailgear.example/page",
    finalUrl: "https://summittrailgear.example/page",
    statusCode: 200,
    headers: {},
    responseTimeMs: 42,
    ...overrides,
  };
}

export function makeScope(overrides: Partial<CrawlScope> = {}): CrawlScope {
  return {
    registrableDomain: "summittrailgear.example",
    fallbackHost: null,
    hostAliases: [],
    seedOrigin: "https://summittrailgear.example",
    seedUrl: "https://summittrailgear.example/",
    ...overrides,
  };
}

/** Test double for S1's normalizeUrl — plain URL-API resolution + trailing-slash strip, no tracking-param logic. */
export function fakeNormalizeUrl(raw: string, base?: string): string | null {
  if (/^(mailto|tel|javascript|data|sms|fax):/i.test(raw)) return null;
  try {
    const u = new URL(raw, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    if (u.pathname !== "/" && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch {
    return null;
  }
}

/** Test double for S1's isInScope — plain host-equality (registrable domain or subdomain), www-insensitive. */
export function fakeIsInScope(normalizedUrl: string, scope: CrawlScope): boolean {
  try {
    const host = new URL(normalizedUrl).hostname.toLowerCase().replace(/^www\./, "");
    const allowedHosts = [scope.registrableDomain, ...scope.hostAliases].map((h) =>
      h.toLowerCase().replace(/^www\./, "")
    );
    return allowedHosts.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}
