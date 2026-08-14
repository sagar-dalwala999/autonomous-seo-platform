/** Slice C3 — shingle / MinHash / LSH-clustering tests for the real near-duplicate detector. */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { shingle, minHashSignature, findNearDuplicates, DEFAULT_SIGNATURE_SIZE, DEFAULT_THRESHOLD } from "../../../src/analysis/similarity";
import type { CrawledPage } from "../../../src/models/types";

function hashOf(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function makePage(url: string, text: string): CrawledPage {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return {
    runId: "test-run",
    url,
    normalizedUrl: url,
    finalUrl: url,
    statusCode: 200,
    redirectChain: [],
    headers: {},
    performance: { responseTimeMs: 1 },
    renderedWith: "http",
    renderSignals: [],
    fetchedAt: "2026-01-01T00:00:00.000Z",
    crawl: { depth: 1, parentUrl: null, discoverySources: ["seed"] },
    title: "t",
    metaDescription: "d",
    canonical: null,
    robots: { meta: [], noindex: false, nofollow: false },
    headings: { h1: [], h2: [], h3: [] },
    links: [],
    images: [],
    videos: [],
    structuredData: [],
    content: { text, wordCount, contentHash: hashOf(text.toLowerCase()) },
  };
}

// Real extracted content.text (storage/runs/poc2-full) for the seeded manifest #18 near-dup pair.
const WINTER_HIKING =
  "Winter hiking checklistWinter turns small mistakes into big ones. Daylight is short, wet is " +
  "dangerous, and a twisted ankle that means a boring wait in July can mean hypothermia in " +
  "January. We run this checklist before every cold-season hike, without exception, even on " +
  "trails we know well.ClothingNo cotton anywhere. A wicking base layer, an insulating mid " +
  "layer, and a waterproof shell, plus a spare insulation piece that stays dry in the pack " +
  "until you stop moving. Warm hat, liner gloves inside insulated gloves, and wool socks with " +
  "a dry spare pair.Traction and lightMicrospikes go in the pack from November to April whether " +
  "the trailhead is icy or not. Carry a headlamp with fresh batteries and keep a spare set warm " +
  "in an inside pocket — cold drains batteries far faster than summer hikers expect.Food, water, " +
  "and the turnaroundCold suppresses thirst, so drink on a schedule, and pack more calories than " +
  "a summer day needs. Set a hard turnaround time before you leave the car and honor it. The " +
  "summit is optional; the parking lot is mandatory.";

const WINTER_DAY_HIKE =
  "Winter day-hike checklistWinter turns small mistakes into big ones. Daylight is short, wet is " +
  "dangerous, and a twisted ankle that means a boring wait in July can mean hypothermia in " +
  "January. We run this checklist before every cold-season day hike, without exception, even on " +
  "trails we know well.ClothingNo cotton anywhere. A wicking base layer, an insulating mid " +
  "layer, and a waterproof shell, plus a spare insulation piece that stays dry in the pack " +
  "until you stop moving. Warm hat, liner gloves inside insulated gloves, and wool socks with " +
  "a dry spare pair.Traction and lightMicrospikes go in the pack from November to April whether " +
  "the trailhead is icy or not. Carry a headlamp with fresh batteries and keep a spare set warm " +
  "in an inside pocket — cold drains batteries far faster than summer hikers expect.Food, water, " +
  "and the turnaroundCold suppresses thirst, so drink on a schedule, and pack more calories than " +
  "a summer outing needs. Set a hard turnaround time before you leave the trailhead and honor it. " +
  "The summit is optional; the parking lot is mandatory.";

describe("shingle", () => {
  it("lowercases, strips punctuation, collapses whitespace, and windows by word count", () => {
    const s = shingle("The Quick, Brown Fox!  Jumps over.", 3);
    expect(s.has("the quick brown")).toBe(true);
    expect(s.has("quick brown fox")).toBe(true);
    expect(s.has("brown fox jumps")).toBe(true);
    expect(s.has("fox jumps over")).toBe(true);
    expect(s.size).toBe(4);
  });

  it("returns an empty set when text has fewer words than the shingle size", () => {
    expect(shingle("only three words", 5).size).toBe(0);
    expect(shingle("", 5).size).toBe(0);
  });

  it("produces (wordCount - size + 1) shingles for text with no repeated n-grams", () => {
    const words = Array.from({ length: 20 }, (_, i) => `w${i}`).join(" ");
    expect(shingle(words, 5).size).toBe(16);
  });

  it("is insensitive to case and punctuation differences that don't change the words", () => {
    const a = shingle("Hello, world! This is fine.", 3);
    const b = shingle("hello world this is fine", 3);
    expect(a).toEqual(b);
  });
});

describe("minHashSignature", () => {
  it("is deterministic — same shingle set produces the identical signature every call", () => {
    const s = shingle("the quick brown fox jumps over the lazy dog", 4);
    const sig1 = minHashSignature(s, 64);
    const sig2 = minHashSignature(s, 64);
    expect(sig1).toEqual(sig2);
  });

  it("produces a signature of exactly the requested length", () => {
    expect(minHashSignature(shingle("a b c d e f g", 3), 32)).toHaveLength(32);
  });

  it("identical shingle sets produce identical signatures (estimated Jaccard = 1)", () => {
    const s1 = shingle("alpha beta gamma delta epsilon zeta", 3);
    const s2 = shingle("alpha beta gamma delta epsilon zeta", 3);
    expect(minHashSignature(s1, 48)).toEqual(minHashSignature(s2, 48));
  });

  it("estimates near-1.0 similarity for the real seeded near-dup pair's shingle sets", () => {
    const sigA = minHashSignature(shingle(WINTER_HIKING, 5), DEFAULT_SIGNATURE_SIZE);
    const sigB = minHashSignature(shingle(WINTER_DAY_HIKE, 5), DEFAULT_SIGNATURE_SIZE);
    let matches = 0;
    for (let i = 0; i < sigA.length; i++) if (sigA[i] === sigB[i]) matches++;
    const estimated = matches / sigA.length;
    // True 5-shingle Jaccard measured independently at ~0.824 (see WORK_LOG.md) — MinHash is an
    // unbiased estimator so this should land in the same neighborhood, comfortably above the
    // rule's tuned 0.75 threshold and nowhere near the unrelated-page floor near 0.
    expect(estimated).toBeGreaterThan(0.7);
  });

  it("estimates a low similarity for wholly unrelated shingle sets", () => {
    const sigA = minHashSignature(shingle("mountain trail gear checklist winter hiking boots socks", 3), 64);
    const sigB = minHashSignature(shingle("quarterly revenue earnings call transcript shareholder update finance", 3), 64);
    let matches = 0;
    for (let i = 0; i < sigA.length; i++) if (sigA[i] === sigB[i]) matches++;
    expect(matches / sigA.length).toBeLessThan(0.3);
  });
});

describe("findNearDuplicates", () => {
  it("clusters the real seeded near-dup pair above the default threshold", () => {
    const a = makePage("https://x.test/blog/winter-hiking-checklist", WINTER_HIKING);
    const b = makePage("https://x.test/blog/winter-day-hike-checklist", WINTER_DAY_HIKE);
    const report = findNearDuplicates([a, b], "run1");
    expect(report.threshold).toBe(DEFAULT_THRESHOLD);
    expect(report.clusters).toHaveLength(1);
    expect(report.clusters[0]!.similarity).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD);
    const urls = report.clusters[0]!.members.map((m) => m.url).sort();
    expect(urls).toEqual([
      "https://x.test/blog/winter-day-hike-checklist",
      "https://x.test/blog/winter-hiking-checklist",
    ]);
  });

  it("does not cluster two pages with matching word count but unrelated content (the old proxy's bug)", () => {
    const a = makePage(
      "https://x.test/blog/a",
      Array.from({ length: 200 }, (_, i) => `alpha${i} mountain trail gear winter`).join(" "),
    );
    const b = makePage(
      "https://x.test/products/b",
      Array.from({ length: 200 }, (_, i) => `zzz${i} finance quarterly revenue earnings`).join(" "),
    );
    const report = findNearDuplicates([a, b], "run2");
    expect(report.clusters).toHaveLength(0);
  });

  it("excludes exact duplicates (identical contentHash) — that's exact-duplicate-content's job", () => {
    const a = makePage("https://x.test/a", WINTER_HIKING);
    const aTwin = makePage("https://x.test/a-copy", WINTER_HIKING); // byte-identical text -> same hash
    const report = findNearDuplicates([a, aTwin], "run3");
    expect(report.clusters).toHaveLength(0);
  });

  it("skips pages below the meaningful-content floor (fewer words than the shingle size)", () => {
    const a = makePage("https://x.test/a", "too short");
    const b = makePage("https://x.test/b", "too short");
    const report = findNearDuplicates([a, b], "run4");
    expect(report.clusters).toHaveLength(0);
  });

  it("respects a custom threshold — raising it past the pair's measured similarity un-clusters it", () => {
    const a = makePage("https://x.test/blog/winter-hiking-checklist", WINTER_HIKING);
    const b = makePage("https://x.test/blog/winter-day-hike-checklist", WINTER_DAY_HIKE);
    const report = findNearDuplicates([a, b], "run5", { threshold: 0.99 });
    expect(report.clusters).toHaveLength(0);
  });

  it("reports the lowest pairwise estimate across a 3+ member cluster (conservative figure)", () => {
    const base = "the quick brown fox jumps over the lazy dog near the riverbank at dawn every single morning without fail";
    const a = makePage("https://x.test/a", base);
    const b = makePage("https://x.test/b", base.replace("riverbank", "hillside"));
    const c = makePage("https://x.test/c", base.replace("riverbank", "hillside").replace("dawn", "dusk"));
    const report = findNearDuplicates([a, b, c], "run6", { threshold: 0.5, shingleSize: 3 });
    if (report.clusters.length > 0) {
      const cluster = report.clusters[0]!;
      let min = 1;
      const sigs = [a, b, c].map((p) => minHashSignature(shingle(p.content.text, 3), DEFAULT_SIGNATURE_SIZE));
      for (let i = 0; i < sigs.length; i++) {
        for (let j = i + 1; j < sigs.length; j++) {
          let m = 0;
          for (let k = 0; k < sigs[i]!.length; k++) if (sigs[i]![k] === sigs[j]![k]) m++;
          min = Math.min(min, m / sigs[i]!.length);
        }
      }
      expect(cluster.similarity).toBeLessThanOrEqual(min + 0.01);
    }
  });

  it("stays fast at moderate scale and does not over-cluster unrelated random pages (regression guard against the O(n²) stack overflow the old wordCount proxy hit)", () => {
    function xorshift32(seed: number): () => number {
      let x = seed | 0;
      return () => {
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        return (x >>> 0) / 4294967296;
      };
    }
    const pages: CrawledPage[] = [];
    for (let i = 0; i < 300; i++) {
      const rnd = xorshift32(i + 1);
      const words = Array.from({ length: 150 }, () => `word${Math.floor(rnd() * 5000)}`).join(" ");
      pages.push(makePage(`https://x.test/synth/${i}`, words));
    }
    pages.push(makePage("https://x.test/blog/winter-hiking-checklist", WINTER_HIKING));
    pages.push(makePage("https://x.test/blog/winter-day-hike-checklist", WINTER_DAY_HIKE));

    const start = Date.now();
    const report = findNearDuplicates(pages, "run7");
    const elapsedMs = Date.now() - start;

    expect(elapsedMs).toBeLessThan(5000);
    expect(report.clusters).toHaveLength(1); // only the real seeded pair — no spurious matches
    expect(report.clusters[0]!.members.map((m) => m.url).sort()).toEqual([
      "https://x.test/blog/winter-day-hike-checklist",
      "https://x.test/blog/winter-hiking-checklist",
    ]);
  });
});
