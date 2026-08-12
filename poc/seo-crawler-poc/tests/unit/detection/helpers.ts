/** Builds honest ExtractionResult literals for detection fixtures — no dependency on src/extraction. */
import { createHash } from "node:crypto";
import type { CrawlScope, ExtractionResult, LinkRecord } from "../../../src/models/types";

export function wordCount(text: string): number {
  return text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;
}

export function link(target: string, type: "internal" | "external"): LinkRecord {
  return {
    source: "https://example.test/",
    target,
    targetNormalized: target,
    anchor: "",
    type,
    rel: null,
    nofollow: false,
    sponsored: false,
    ugc: false,
    targetAttr: null,
  };
}

/** wordCount/contentHash are derived from `text`, never hand-typed, so fixtures can't drift. */
export function extraction(text: string, links: LinkRecord[] = []): ExtractionResult {
  const normalized = text.trim().replace(/\s+/g, " ").toLowerCase();
  return {
    title: null,
    metaDescription: null,
    canonical: null,
    robots: { meta: [], noindex: false, nofollow: false },
    headings: { h1: [], h2: [], h3: [] },
    links,
    images: [],
    videos: [],
    structuredData: [],
    content: {
      text,
      wordCount: wordCount(text),
      contentHash: createHash("sha256").update(normalized).digest("hex"),
    },
    titles: [],
    metaDescriptions: [],
    social: { og: {}, twitter: {} },
    hreflang: [],
    metaRefresh: null,
    metaKeywords: null,
    pixelWidths: { titlePx: null, metaDescriptionPx: null },
    pageStats: { htmlBytes: 0, textRatio: 0, domNodes: 0, contentEncoding: null, httpVersion: null },
  };
}

export const FAKE_SCOPE: CrawlScope = {
  registrableDomain: "example.test",
  fallbackHost: null,
  hostAliases: [],
  seedOrigin: "https://example.test",
  seedUrl: "https://example.test/",
};
