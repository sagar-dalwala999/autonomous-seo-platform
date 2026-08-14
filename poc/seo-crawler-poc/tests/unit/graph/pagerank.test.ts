import { describe, expect, it } from "vitest";
import { computeGraph, DEFAULT_DAMPING } from "../../../src/graph/pagerank";
import { RunStore } from "../../../src/storage/runStore";
import { makeLink, makePage } from "./fixtures";

describe("computeGraph", () => {
  it("does not crash on an empty page set", () => {
    const report = computeGraph([], "empty-run");
    expect(report.pages).toEqual([]);
    expect(report.orphans).toEqual([]);
    expect(report.iterations).toBe(0);
    expect(report.converged).toBe(true);
  });

  it("does not crash on a single page and ranks it 100 (nothing to compare against)", () => {
    const page = makePage({ url: "https://x.test/", crawl: { depth: 0, parentUrl: null, discoverySources: ["seed"] } });
    const report = computeGraph([page], "single-run");
    expect(report.pages).toHaveLength(1);
    expect(report.pages[0]!.internalRank).toBe(100);
    expect(report.pages[0]!.rawRank).toBeCloseTo(1, 6);
    expect(report.converged).toBe(true);
  });

  it("converges a 3-node cycle to equal ranks (symmetric graph, known answer)", () => {
    const a = makePage({ url: "https://x.test/a", links: [makeLink("https://x.test/a", "https://x.test/b")] });
    const b = makePage({ url: "https://x.test/b", links: [makeLink("https://x.test/b", "https://x.test/c")] });
    const c = makePage({ url: "https://x.test/c", links: [makeLink("https://x.test/c", "https://x.test/a")] });
    const report = computeGraph([a, b, c], "cycle-run");

    expect(report.converged).toBe(true);
    for (const p of report.pages) {
      expect(p.rawRank).toBeCloseTo(1 / 3, 4);
      expect(p.internalRank).toBe(100); // no variance -> every node ties for best
      expect(p.outlinks).toBe(1);
      expect(p.uniqueInlinks).toBe(1);
    }
  });

  it("ranks the hub highest in a hub-and-spoke graph", () => {
    const hub = makePage({ url: "https://x.test/hub" }); // dangling on purpose
    const spokes = ["s1", "s2", "s3", "s4"].map((slug) =>
      makePage({
        url: `https://x.test/${slug}`,
        links: [makeLink(`https://x.test/${slug}`, "https://x.test/hub")],
      }),
    );
    const report = computeGraph([hub, ...spokes], "hub-run");

    const hubScore = report.pages.find((p) => p.url === "https://x.test/hub")!;
    const spokeScores = report.pages.filter((p) => p.url !== "https://x.test/hub");
    for (const s of spokeScores) expect(hubScore.rawRank).toBeGreaterThan(s.rawRank);
    expect(hubScore.internalRank).toBe(100);
    expect(hubScore.uniqueInlinks).toBe(4);
  });

  it("conserves total rank at ~1.0 across iterations even with a dangling node (the classic bug)", () => {
    const dangling = makePage({ url: "https://x.test/dead-end" }); // zero outlinks
    const a = makePage({
      url: "https://x.test/a",
      links: [makeLink("https://x.test/a", "https://x.test/dead-end"), makeLink("https://x.test/a", "https://x.test/b")],
    });
    const b = makePage({ url: "https://x.test/b", links: [makeLink("https://x.test/b", "https://x.test/a")] });
    const pages = [dangling, a, b];

    for (const maxIterations of [1, 2, 5, 100]) {
      const report = computeGraph(pages, "dangling-run", { maxIterations });
      const total = report.pages.reduce((sum, p) => sum + p.rawRank, 0);
      expect(total).toBeCloseTo(1, 4);
    }
  });

  it("flags a zero-inlink page as an orphan but excludes the seed", () => {
    const seed = makePage({ url: "https://x.test/", crawl: { depth: 0, parentUrl: null, discoverySources: ["seed"] } });
    const linked = makePage({
      url: "https://x.test/linked",
      links: [],
    });
    seed.links = [makeLink("https://x.test/", "https://x.test/linked")];
    const orphaned = makePage({ url: "https://x.test/gear-archive", links: [] });

    const report = computeGraph([seed, linked, orphaned], "orphan-run");
    expect(report.orphans).toEqual(["https://x.test/gear-archive"]);
    expect(report.orphans).not.toContain("https://x.test/");
  });

  it("does not flag a zero-inlink 404 page as an orphan (broken link, not orphaned content)", () => {
    const seed = makePage({ url: "https://x.test/", crawl: { depth: 0, parentUrl: null, discoverySources: ["seed"] } });
    const broken = makePage({ url: "https://x.test/gone", statusCode: 404, links: [] });
    const report = computeGraph([seed, broken], "404-orphan-run");
    expect(report.orphans).toEqual([]);
  });

  it("dedupes duplicate links from the same page to the same target into one edge (documented choice)", () => {
    const source = makePage({
      url: "https://x.test/source",
      links: [
        makeLink("https://x.test/source", "https://x.test/target", { anchor: "nav" }),
        makeLink("https://x.test/source", "https://x.test/target", { anchor: "footer" }),
      ],
    });
    const target = makePage({ url: "https://x.test/target" });
    const report = computeGraph([source, target], "dup-run");

    const sourceScore = report.pages.find((p) => p.url === "https://x.test/source")!;
    const targetScore = report.pages.find((p) => p.url === "https://x.test/target")!;
    expect(sourceScore.outlinks).toBe(1); // deduped edge count
    expect(targetScore.inlinks).toBe(2); // raw occurrence count preserved as evidence
    expect(targetScore.uniqueInlinks).toBe(1); // deduped by source page
  });

  it("excludes self-links from the graph", () => {
    const page = makePage({
      url: "https://x.test/self",
      links: [makeLink("https://x.test/self", "https://x.test/self")],
    });
    const report = computeGraph([page], "self-link-run");
    expect(report.pages[0]!.outlinks).toBe(0);
    expect(report.pages[0]!.uniqueInlinks).toBe(0);
  });

  it("is deterministic — identical input produces identical output on repeat runs", () => {
    const a = makePage({ url: "https://x.test/a", links: [makeLink("https://x.test/a", "https://x.test/b")] });
    const b = makePage({ url: "https://x.test/b", links: [makeLink("https://x.test/b", "https://x.test/a")] });
    const pages = [a, b];

    const r1 = computeGraph(pages, "det-run");
    const r2 = computeGraph(pages, "det-run");
    expect({ ...r1, generatedAt: "x" }).toEqual({ ...r2, generatedAt: "x" });
  });

  it("fills depth from the crawler's own crawl.depth (no recomputation)", () => {
    const page = makePage({ url: "https://x.test/deep", crawl: { depth: 3, parentUrl: "https://x.test/", discoverySources: ["html-link"] } });
    const report = computeGraph([page], "depth-run");
    expect(report.pages[0]!.depth).toBe(3);
  });

  it("pageId matches RunStore's own pageId convention so graph scores join to page records", () => {
    const page = makePage({ url: "https://x.test/join-me" });
    const report = computeGraph([page], "join-run");
    expect(report.pages[0]!.pageId).toBe(RunStore.pageIdFor(page.normalizedUrl));
  });

  it("respects a custom damping factor and reports it honestly", () => {
    const page = makePage({ url: "https://x.test/" });
    const report = computeGraph([page], "damping-run", { damping: 0.5 });
    expect(report.dampingFactor).toBe(0.5);
    expect(report.dampingFactor).not.toBe(DEFAULT_DAMPING);
  });

  it("stops at maxIterations and reports converged: false when it never settles within the cap", () => {
    const a = makePage({ url: "https://x.test/a", links: [makeLink("https://x.test/a", "https://x.test/b")] });
    const b = makePage({ url: "https://x.test/b", links: [makeLink("https://x.test/b", "https://x.test/a")] });
    const report = computeGraph([a, b], "cap-run", { maxIterations: 1, epsilon: 0 });
    expect(report.iterations).toBe(1);
    expect(report.converged).toBe(false);
  });

  describe("query-string node identity (regression: measured defect — pathname-only keying silently merged distinct pages)", () => {
    it("keeps two pages differing only by query string as separate nodes with separate scores", () => {
      const base = makePage({ url: "https://x.test/search" });
      const variant = makePage({ url: "https://x.test/search?q=tents" });
      const linker = makePage({
        url: "https://x.test/linker",
        links: [makeLink("https://x.test/linker", "https://x.test/search?q=tents")],
      });
      const report = computeGraph([base, variant, linker], "query-id-run");

      expect(report.pages).toHaveLength(3);
      const baseScore = report.pages.find((p) => p.url === "https://x.test/search")!;
      const variantScore = report.pages.find((p) => p.url === "https://x.test/search?q=tents")!;
      expect(baseScore).toBeDefined();
      expect(variantScore).toBeDefined();
      // Only the query-string variant was actually linked to — the base URL must not inherit it.
      expect(variantScore.uniqueInlinks).toBe(1);
      expect(baseScore.uniqueInlinks).toBe(0);
    });

    it("routes an outlink to the exact query-string target it names, not a same-path sibling", () => {
      const targetA = makePage({ url: "https://x.test/p?id=1" });
      const targetB = makePage({ url: "https://x.test/p?id=2" });
      const source = makePage({
        url: "https://x.test/src",
        links: [makeLink("https://x.test/src", "https://x.test/p?id=2")],
      });
      const report = computeGraph([targetA, targetB, source], "query-target-run");

      const a = report.pages.find((p) => p.url === "https://x.test/p?id=1")!;
      const b = report.pages.find((p) => p.url === "https://x.test/p?id=2")!;
      expect(a.uniqueInlinks).toBe(0);
      expect(b.uniqueInlinks).toBe(1);
    });

    it("flags a zero-inlink query-string variant as its own orphan, independent of a same-path sibling", () => {
      const seed = makePage({ url: "https://x.test/", crawl: { depth: 0, parentUrl: null, discoverySources: ["seed"] } });
      const linkedBase = makePage({ url: "https://x.test/hub" });
      seed.links = [makeLink("https://x.test/", "https://x.test/hub")];
      const orphanVariant = makePage({ url: "https://x.test/hub?ref=email" });

      const report = computeGraph([seed, linkedBase, orphanVariant], "query-orphan-run");
      expect(report.orphans).toEqual(["https://x.test/hub?ref=email"]);
      expect(report.orphans).not.toContain("https://x.test/hub");
    });

    it("still shares identity across host/scheme aliasing (unchanged, deliberate behavior)", () => {
      const bare = makePage({ url: "https://x.test/jobs" });
      const www = makePage({ url: "https://www.x.test/jobs" });
      const linker = makePage({
        url: "https://x.test/linker",
        links: [makeLink("https://x.test/linker", "https://www.x.test/jobs")],
      });
      const report = computeGraph([bare, www, linker], "alias-run");
      // Both alias variants resolve to the same node identity (path-only, host stripped) —
      // the FIRST one in input order wins, exactly as before this fix.
      const bareScore = report.pages.find((p) => p.url === "https://x.test/jobs")!;
      expect(bareScore.uniqueInlinks).toBe(1);
      expect(report.pages).toHaveLength(3);
    });
  });
});
