/** Slice S3 implements. */
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { RobotsInfo, SitemapFileRecord, SitemapResult, SitemapUrlEntry } from "../models/types";
import { fetchWithTimeout, resolveAbsolute } from "./http";

const MAX_DEPTH = 5;
const MAX_ENTRIES = 50_000;

// url/sitemap forced to arrays so a single-entry file doesn't collapse to a bare object.
const xmlParser = new XMLParser({
  ignoreAttributes: true,
  isArray: (name) => name === "url" || name === "sitemap",
});

interface FetchedFile {
  statusCode: number | null;
  body: string | null;
  bytes: Uint8Array | null;
  contentType: string | null;
  error: string | null;
}

/**
 * Discover sitemap URLs: robots.txt declarations first, then <origin>/sitemap.xml fallback.
 * Recurses sitemap indexes. Never throws — fetch/parse problems land in result.errors/files.
 */
// Conventional locations tried when robots.txt declares nothing (or is absent) — ordered by
// how common they are: plain, Yoast/WP-SEO, WordPress core, generic index.
const FALLBACK_SITEMAP_PATHS = ["/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml", "/sitemap-index.xml"];

export async function discoverSitemaps(robots: RobotsInfo, origin: string): Promise<SitemapResult> {
  const declared = robots.sitemaps.length > 0;
  const candidates = declared
    ? robots.sitemaps
    : FALLBACK_SITEMAP_PATHS.map((p) => new URL(p, origin).toString());

  const entries: SitemapUrlEntry[] = [];
  const seenEntryUrls = new Set<string>();
  const files: SitemapFileRecord[] = [];
  const errors: string[] = [];
  const visited = new Set<string>();

  async function visit(rawUrl: string, depth: number): Promise<void> {
    const resolved = resolveAbsolute(rawUrl, origin);
    if (!resolved) {
      errors.push(`invalid sitemap URL: ${rawUrl}`);
      return;
    }
    if (visited.has(resolved)) return; // loop protection (also covers self-referencing indexes)
    visited.add(resolved);

    if (depth > MAX_DEPTH) {
      errors.push(`sitemap recursion depth exceeded at ${resolved}`);
      return;
    }
    if (entries.length >= MAX_ENTRIES) return;

    const file = await fetchSitemapFile(resolved);

    if (file.error !== null || file.body === null) {
      files.push({ url: resolved, statusCode: file.statusCode, kind: "unknown", urlCount: 0, error: file.error });
      if (file.error) errors.push(file.error);
      return;
    }

    if (looksGzipped(resolved, file.contentType, file.bytes)) {
      const msg = "gzip not supported in POC";
      files.push({ url: resolved, statusCode: file.statusCode, kind: "unknown", urlCount: 0, error: msg });
      errors.push(msg);
      return;
    }

    const validation = XMLValidator.validate(file.body);
    if (validation !== true) {
      const msg = `malformed XML: ${validation.err.msg}`;
      files.push({ url: resolved, statusCode: file.statusCode, kind: "unknown", urlCount: 0, error: msg });
      errors.push(msg);
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = xmlParser.parse(file.body);
    } catch (err) {
      const msg = `XML parse threw: ${err instanceof Error ? err.message : String(err)}`;
      files.push({ url: resolved, statusCode: file.statusCode, kind: "unknown", urlCount: 0, error: msg });
      errors.push(msg);
      return;
    }

    const urlset = parsed.urlset as { url?: Array<{ loc?: unknown }> } | undefined;
    if (urlset) {
      const urls = urlset.url ?? [];
      let count = 0;
      for (const u of urls) {
        const loc = typeof u?.loc === "string" ? u.loc.trim() : null;
        if (!loc) continue;
        count++;
        if (entries.length >= MAX_ENTRIES) continue;
        if (seenEntryUrls.has(loc)) continue;
        seenEntryUrls.add(loc);
        entries.push({ url: loc, sourceSitemap: resolved });
      }
      files.push({ url: resolved, statusCode: file.statusCode, kind: "urlset", urlCount: count, error: null });
      return;
    }

    const sitemapindex = parsed.sitemapindex as { sitemap?: Array<{ loc?: unknown }> } | undefined;
    if (sitemapindex) {
      const children = sitemapindex.sitemap ?? [];
      files.push({ url: resolved, statusCode: file.statusCode, kind: "index", urlCount: children.length, error: null });
      for (const child of children) {
        const loc = typeof child?.loc === "string" ? child.loc.trim() : null;
        if (!loc) continue;
        await visit(loc, depth + 1);
      }
      return;
    }

    files.push({
      url: resolved,
      statusCode: file.statusCode,
      kind: "unknown",
      urlCount: 0,
      error: "no <urlset> or <sitemapindex> root element",
    });
  }

  for (const candidate of candidates) {
    await visit(candidate, 0);
    // Undeclared probing stops at the first hit — later paths are alternatives, not additions.
    if (!declared && entries.length > 0) break;
  }

  return { entries, files, errors };
}

async function fetchSitemapFile(url: string): Promise<FetchedFile> {
  try {
    const res = await fetchWithTimeout(url);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const contentType = res.headers.get("content-type");
    if (res.status !== 200) {
      return { statusCode: res.status, body: null, bytes, contentType, error: `fetch failed: HTTP ${res.status}` };
    }
    const body = Buffer.from(bytes).toString("utf-8");
    return { statusCode: res.status, body, bytes, contentType, error: null };
  } catch (err) {
    return {
      statusCode: null,
      body: null,
      bytes: null,
      contentType: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function looksGzipped(url: string, contentType: string | null, bytes: Uint8Array | null): boolean {
  if (url.toLowerCase().endsWith(".gz")) return true;
  if (contentType?.toLowerCase().includes("gzip")) return true;
  return bytes !== null && bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}
