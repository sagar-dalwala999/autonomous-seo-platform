import type { CheerioAPI } from "cheerio";
import type { ImageRecord } from "../models/types";
import { extractFormat, parseIntAttr, resolveAbsolute } from "./shared";

export function extractImages($: CheerioAPI, base: string): ImageRecord[] {
  const out: ImageRecord[] = [];
  $("img").each((_, el) => {
    const srcRaw = $(el).attr("src");
    if (!srcRaw || !srcRaw.trim()) return; // no src — nothing to resolve/record

    const url = resolveAbsolute(srcRaw.trim(), base);
    if (url === null) return;

    const altAttr = $(el).attr("alt");
    out.push({
      url,
      alt: altAttr === undefined ? null : altAttr, // missing vs present-empty is evidence
      width: parseIntAttr($(el).attr("width")),
      height: parseIntAttr($(el).attr("height")),
      format: extractFormat(url),
    });
  });
  return out;
}
