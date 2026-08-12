import type { CheerioAPI } from "cheerio";
import type { StructuredDataRecord } from "../models/types";

export function extractStructuredData($: CheerioAPI): StructuredDataRecord[] {
  const out: StructuredDataRecord[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = ($(el).html() ?? "").trim(); // outer-trim only — internal JSON whitespace must stay byte-faithful
    let parsed: unknown = null;
    let parseError: string | null = null;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err);
    }
    out.push({ type: "application/ld+json", raw, parsed, parseError });
  });
  return out;
}
