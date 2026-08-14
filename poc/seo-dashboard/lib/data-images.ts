/** Server-only. New lib file for the /images screen — no aggregate images API route exists yet
 *  (checked app/api/crawls/:id/**, only per-page media/route.ts), so this reads the same source
 *  app/issues + app/pages already read (getPages, do-not-touch) directly, matching the app's own
 *  convention of RSC pages calling lib/ rather than fetching their own API. Built only from real
 *  ImageRecord fields (lib/types.ts) — this crawler captures url/alt/width/height/format only, no
 *  CSS-background harvesting or pixel-decoded size, so the table never claims fields it doesn't have. */
import { getPages } from "./data";

export type AltState = "missing" | "empty" | "described";

export type SizeCategory = "normal" | "large" | "oversized";

export interface ImageRow {
  key: string;
  url: string;
  altState: AltState;
  alt: string | null;
  width: number | null;
  height: number | null;
  format: string | null;
  hasDimensions: boolean;
  sizeBytes: number | null;
  sizeCategory: SizeCategory | null;
  usageCount: number;
  pages: { pageId: string; url: string }[];
}

function altStateOf(alt: string | null): AltState {
  if (alt === null) return "missing";
  if (alt.trim() === "") return "empty";
  return "described";
}

function sizeCategoryOf(bytes: number | null): SizeCategory | null {
  if (bytes === null) return null;
  if (bytes > 500 * 1024) return "oversized";
  if (bytes > 100 * 1024) return "large";
  return "normal";
}

export async function buildImageRows(runId: string): Promise<ImageRow[]> {
  const pages = await getPages(runId);
  const rows = new Map<string, ImageRow>();

  for (const p of pages) {
    for (const img of p.images) {
      const bytes = (img as { sizeBytes?: number | null }).sizeBytes ?? null;
      const existing = rows.get(img.url);
      if (existing) {
        existing.usageCount++;
        if (existing.pages.length < 50) existing.pages.push({ pageId: p.pageId, url: p.url });
        if (existing.sizeBytes === null && bytes !== null) {
          existing.sizeBytes = bytes;
          existing.sizeCategory = sizeCategoryOf(bytes);
        }
        // First non-missing alt wins if the page-level record disagrees across usages.
        if (existing.altState === "missing" && img.alt !== null) {
          existing.alt = img.alt;
          existing.altState = altStateOf(img.alt);
        }
        continue;
      }
      rows.set(img.url, {
        key: img.url,
        url: img.url,
        altState: altStateOf(img.alt),
        alt: img.alt,
        width: img.width,
        height: img.height,
        format: img.format,
        hasDimensions: img.width !== null && img.height !== null,
        sizeBytes: bytes,
        sizeCategory: sizeCategoryOf(bytes),
        usageCount: 1,
        pages: [{ pageId: p.pageId, url: p.url }],
      });
    }
  }
  return [...rows.values()].sort((a, b) => b.usageCount - a.usageCount);
}
