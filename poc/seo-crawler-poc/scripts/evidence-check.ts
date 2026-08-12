/**
 * The seeded-evidence checklist (brief §6): 18 manifest items, each checked programmatically
 * against a target-site bench run's stored records. Also re-derives the manifest at runtime by
 * grepping ../target-site for "seeded" comments, so the appendix stays honest if fixtures change.
 * Usage: tsx scripts/evidence-check.ts [--bench-dir storage/bench/<stamp>]
 */
import { parseArgs } from "node:util";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CrawledPage, CrawlSummary, FailureRecord, SitemapResult } from "../src/models/types";
import { BENCH_DIR, TARGET_SITE_DIR, PROJECT_ROOT } from "./lib/paths";
import { loadPages, loadFailures, loadBlocked, loadSitemaps, loadReport, pathnameOf, byPath } from "./lib/records";

type Status = "PASS" | "FAIL" | "N/A";
interface CheckResult {
  id: string;
  expectation: string;
  status: Status;
  evidence: string;
}

interface RunData {
  found: boolean;
  runId: string | null;
  pages: CrawledPage[];
  failures: FailureRecord[];
  blocked: string[];
  sitemaps: SitemapResult | null;
  report: CrawlSummary | null;
}

const EMPTY_RUN: RunData = { found: false, runId: null, pages: [], failures: [], blocked: [], sitemaps: null, report: null };

async function loadRun(runId: string | undefined): Promise<RunData> {
  if (!runId) return EMPTY_RUN;
  const pages = await loadPages(runId);
  const report = await loadReport(runId);
  if (pages.length === 0 && !report) return { ...EMPTY_RUN, runId };
  return {
    found: true,
    runId,
    pages,
    failures: await loadFailures(runId),
    blocked: await loadBlocked(runId),
    sitemaps: await loadSitemaps(runId),
    report,
  };
}

function na(id: string, expectation: string, why: string): CheckResult {
  return { id, expectation, status: "N/A", evidence: why };
}

/** Builds a targetPath -> Set(sourcePath) internal-inlink map from every page's links[]. */
function buildInlinkMap(pages: CrawledPage[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const p of pages) {
    const sourcePath = pathnameOf(p.finalUrl ?? p.url);
    for (const link of p.links) {
      if (link.type !== "internal") continue;
      const targetPath = pathnameOf(link.targetNormalized ?? link.target);
      if (!targetPath || !sourcePath) continue;
      if (!map.has(targetPath)) map.set(targetPath, new Set());
      map.get(targetPath)!.add(sourcePath);
    }
  }
  return map;
}

function runChecks(full: RunData, robots: RunData, chain: RunData, loop: RunData): CheckResult[] {
  const results: CheckResult[] = [];
  const push = (r: CheckResult) => results.push(r);

  // #1 — /about: no metadata export -> title + metaDescription both null.
  {
    const id = "1";
    const exp = "/about record has title:null and metaDescription:null";
    if (!full.found) push(na(id, exp, "target-full run not found"));
    else {
      const p = byPath(full.pages, "/about");
      push({
        id,
        expectation: exp,
        status: p && p.title === null && p.metaDescription === null ? "PASS" : "FAIL",
        evidence: p
          ? `pages/<id-for-/about>.json#title=${JSON.stringify(p.title)},metaDescription=${JSON.stringify(p.metaDescription)}`
          : "/about not found in pages/*.json",
      });
    }
  }

  // #2 — duplicate title pair: /blog/rain-gear-care & /blog/layering-basics.
  {
    const id = "2";
    const exp = "/blog/rain-gear-care and /blog/layering-basics share an identical title";
    if (!full.found) push(na(id, exp, "target-full run not found"));
    else {
      const a = byPath(full.pages, "/blog/rain-gear-care");
      const b = byPath(full.pages, "/blog/layering-basics");
      const pass = Boolean(a && b && a.title && a.title === b.title);
      push({
        id,
        expectation: exp,
        status: pass ? "PASS" : "FAIL",
        evidence: `pages/*.json#title: rain-gear-care=${JSON.stringify(a?.title)}, layering-basics=${JSON.stringify(b?.title)}`,
      });
    }
  }

  // #3 — title length outliers: overlong (>70) on /guides/thru-hiking-gear-guide, short (<15) on /contact.
  {
    const id = "3";
    const exp = "/guides/thru-hiking-gear-guide title >70 chars; /contact title <15 chars";
    if (!full.found) push(na(id, exp, "target-full run not found"));
    else {
      const long = byPath(full.pages, "/guides/thru-hiking-gear-guide");
      const short = byPath(full.pages, "/contact");
      const longOk = Boolean(long?.title && long.title.length > 70);
      const shortOk = Boolean(short?.title && short.title.length < 15);
      push({
        id,
        expectation: exp,
        status: longOk && shortOk ? "PASS" : "FAIL",
        evidence: `guide title len=${long?.title?.length ?? "n/a"}; contact title len=${short?.title?.length ?? "n/a"}`,
      });
    }
  }

  // #4 — missing meta description on /about (dup of #1's page) and /products/granite-hiking-boots.
  {
    const id = "4";
    const exp = "/about and /products/granite-hiking-boots both have metaDescription:null";
    if (!full.found) push(na(id, exp, "target-full run not found"));
    else {
      const about = byPath(full.pages, "/about");
      const granite = byPath(full.pages, "/products/granite-hiking-boots");
      const pass = about?.metaDescription === null && granite?.metaDescription === null;
      push({
        id,
        expectation: exp,
        status: pass ? "PASS" : "FAIL",
        evidence: `about.metaDescription=${JSON.stringify(about?.metaDescription)}, granite.metaDescription=${JSON.stringify(granite?.metaDescription)}`,
      });
    }
  }

  // #5 — duplicate meta description: /blog/choosing-hiking-boots & /blog/backpack-fitting.
  {
    const id = "5";
    const exp = "/blog/choosing-hiking-boots and /blog/backpack-fitting share an identical metaDescription";
    if (!full.found) push(na(id, exp, "target-full run not found"));
    else {
      const a = byPath(full.pages, "/blog/choosing-hiking-boots");
      const b = byPath(full.pages, "/blog/backpack-fitting");
      const pass = Boolean(a && b && a.metaDescription && a.metaDescription === b.metaDescription);
      push({
        id,
        expectation: exp,
        status: pass ? "PASS" : "FAIL",
        evidence: `pages/*.json#metaDescription equal: ${pass}`,
      });
    }
  }

  // #6 — heading hierarchy: /contact no-H1, /products/cascade-rain-shell double-H1, /blog/trail-nutrition H1->H3 jump.
  {
    const id = "6";
    const exp = "/contact has 0 H1s; /products/cascade-rain-shell has 2+ H1s; /blog/trail-nutrition has H1+H3 but 0 H2s";
    if (!full.found) push(na(id, exp, "target-full run not found"));
    else {
      const contact = byPath(full.pages, "/contact");
      const cascade = byPath(full.pages, "/products/cascade-rain-shell");
      const nutrition = byPath(full.pages, "/blog/trail-nutrition");
      const contactOk = contact?.headings.h1.length === 0;
      const cascadeOk = (cascade?.headings.h1.length ?? 0) >= 2;
      const nutritionOk =
        nutrition?.headings.h1.length === 1 && nutrition.headings.h2.length === 0 && nutrition.headings.h3.length >= 1;
      push({
        id,
        expectation: exp,
        status: contactOk && cascadeOk && nutritionOk ? "PASS" : "FAIL",
        evidence: `contact.h1=${contact?.headings.h1.length}, cascade.h1=${cascade?.headings.h1.length}, nutrition.h1/h2/h3=${nutrition?.headings.h1.length}/${nutrition?.headings.h2.length}/${nutrition?.headings.h3.length}`,
      });
    }
  }

  // #7 — broken internal hrefs recorded as http-4xx failures.
  {
    const id = "7";
    const exp = "/gear-sale, /blog/ultralight-tents, /products/alpine-tent recorded in failures.json as http-4xx";
    if (!full.found) push(na(id, exp, "target-full run not found"));
    else {
      const brokenPaths = ["/gear-sale", "/blog/ultralight-tents", "/products/alpine-tent"];
      const found = brokenPaths.map((bp) => {
        const f = full.failures.find((fr) => pathnameOf(fr.normalizedUrl ?? fr.url) === bp && fr.reason === "http-4xx");
        return { path: bp, found: Boolean(f) };
      });
      const pass = found.every((f) => f.found);
      push({
        id,
        expectation: exp,
        status: pass ? "PASS" : "FAIL",
        evidence: `failures.json: ${found.map((f) => `${f.path}=${f.found ? "http-4xx" : "MISSING"}`).join(", ")}`,
      });
    }
  }

  // #8 — /gear-archive orphan (or, honoring the brief's own hedge, genuinely undiscoverable: absent from
  // both html-discovery and the sitemap — since a page with zero inlinks and no sitemap entry cannot be
  // reached by a crawler that only discovers via links + sitemap, unless seeded directly).
  {
    const id = "8";
    const exp = "/gear-archive has zero inlinks -> report.orphanCandidates contains it (or is confirmed undiscoverable)";
    if (!full.found) push(na(id, exp, "target-full run not found"));
    else {
      const page = byPath(full.pages, "/gear-archive");
      const inSitemap = full.sitemaps?.entries.some((e) => pathnameOf(e.url) === "/gear-archive") ?? false;
      const inOrphanList = full.report?.orphanCandidates.some((u) => pathnameOf(u) === "/gear-archive") ?? false;
      let pass: boolean;
      let evidence: string;
      if (page) {
        pass = inOrphanList;
        evidence = `crawled; report.orphanCandidates includes /gear-archive = ${inOrphanList}`;
      } else {
        pass = !inSitemap;
        evidence = `not crawled (zero inlinks + absent from sitemap = undiscoverable); sitemap absence confirmed = ${!inSitemap}`;
      }
      push({ id, expectation: exp, status: pass ? "PASS" : "FAIL", evidence });
    }
  }

  // #9 — /products/summit-stove weakly linked: sole inlink is /guides/first-time-backpacking.
  {
    const id = "9";
    const exp = "/products/summit-stove's only inlink is /guides/first-time-backpacking";
    if (!full.found) push(na(id, exp, "target-full run not found"));
    else {
      const inlinks = buildInlinkMap(full.pages).get("/products/summit-stove") ?? new Set<string>();
      const pass = inlinks.size === 1 && inlinks.has("/guides/first-time-backpacking");
      push({
        id,
        expectation: exp,
        status: pass ? "PASS" : "FAIL",
        evidence: `inlink sources found: [${[...inlinks].join(", ")}]`,
      });
    }
  }

  // #10 — image evidence: missing alt, oversized image present, missing dimensions, BMP format.
  {
    const id = "10";
    const exp =
      "missing-alt img on /products/switchback-trekking-poles; hero-large.png present on the guide; homepage hero img has no width/height; BMP img on /products/granite-hiking-boots";
    if (!full.found) push(na(id, exp, "target-full run not found"));
    else {
      const poles = byPath(full.pages, "/products/switchback-trekking-poles");
      const guide = byPath(full.pages, "/guides/thru-hiking-gear-guide");
      const home = byPath(full.pages, "/");
      const granite = byPath(full.pages, "/products/granite-hiking-boots");
      const noAlt = poles?.images.some((i) => i.alt === null) ?? false;
      const largeImgPresent = guide?.images.some((i) => i.url.includes("hero-large")) ?? false;
      const noDims = home?.images.some((i) => i.url.includes("hero-home") && i.width === null && i.height === null) ?? false;
      const bmp = granite?.images.some((i) => i.format === "bmp") ?? false;
      push({
        id,
        expectation: exp,
        status: noAlt && largeImgPresent && noDims && bmp ? "PASS" : "FAIL",
        evidence: `noAlt=${noAlt}, largeImgPresent=${largeImgPresent} (byte-size not in schema — presence only), noDims=${noDims}, bmpFormat=${bmp}`,
      });
    }
  }

  // #11 — structured data: invalid JSON-LD, wrong schema type, valid-but-incomplete Product.
  {
    const id = "11";
    const exp =
      "/blog/choosing-hiking-boots has unparseable JSON-LD (parseError set); /blog/layering-basics has @type:Recipe on an article; /products/ridgeline-backpack-45l has Product JSON-LD missing offers";
    if (!full.found) push(na(id, exp, "target-full run not found"));
    else {
      const boots = byPath(full.pages, "/blog/choosing-hiking-boots");
      const layering = byPath(full.pages, "/blog/layering-basics");
      const ridgeline = byPath(full.pages, "/products/ridgeline-backpack-45l");
      const invalidJsonLd = boots?.structuredData.some((sd) => sd.parsed === null && sd.parseError !== null) ?? false;
      const recipeOnArticle = layering?.structuredData.some((sd) => {
        const parsed = sd.parsed as { "@type"?: string } | null;
        return parsed?.["@type"] === "Recipe";
      }) ?? false;
      const productMissingOffers = ridgeline?.structuredData.some((sd) => {
        const parsed = sd.parsed as { "@type"?: string; offers?: unknown } | null;
        return parsed?.["@type"] === "Product" && parsed.offers === undefined;
      }) ?? false;
      push({
        id,
        expectation: exp,
        status: invalidJsonLd && recipeOnArticle && productMissingOffers ? "PASS" : "FAIL",
        evidence: `invalidJsonLd=${invalidJsonLd}, recipeOnArticle=${recipeOnArticle}, productMissingOffers=${productMissingOffers}`,
      });
    }
  }

  // #12 — accidental noindex on /products/switchback-trekking-poles.
  {
    const id = "12";
    const exp = "/products/switchback-trekking-poles has robots.noindex:true";
    if (!full.found) push(na(id, exp, "target-full run not found"));
    else {
      const p = byPath(full.pages, "/products/switchback-trekking-poles");
      push({
        id,
        expectation: exp,
        status: p?.robots.noindex === true ? "PASS" : "FAIL",
        evidence: `robots.noindex=${p?.robots.noindex}`,
      });
    }
  }

  // #13 — robots-on run: /guides/* blocked, never fetched.
  {
    const id = "13";
    const exp = "robots-on run: /guides/* URLs appear in blocked.json";
    if (!robots.found) push(na(id, exp, "target-robots run not found"));
    else {
      const blockedGuides = robots.blocked.filter((u) => (pathnameOf(u) ?? "").startsWith("/guides"));
      push({
        id,
        expectation: exp,
        status: blockedGuides.length > 0 ? "PASS" : "FAIL",
        evidence: `blocked.json guides entries: [${blockedGuides.join(", ")}]`,
      });
    }
  }

  // #14 — sitemap 404 entry + cross-ref catches the omissions.
  {
    const id = "14";
    const exp =
      "sitemaps.json includes /guides/gear-repair (404); report.sitemap.sitemapEntriesFailed catches it; crawledNotInSitemap surfaces >=2 of [/contact,/blog/rain-gear-care,/products/summit-stove]";
    if (!full.found) push(na(id, exp, "target-full run not found"));
    else {
      const hasGearRepair = full.sitemaps?.entries.some((e) => pathnameOf(e.url) === "/guides/gear-repair") ?? false;
      const failedCatches = full.report?.sitemap.sitemapEntriesFailed.some((u) => pathnameOf(u) === "/guides/gear-repair") ?? false;
      const omitted = ["/contact", "/blog/rain-gear-care", "/products/summit-stove"];
      const crawledNotInSitemapPaths = (full.report?.sitemap.crawledNotInSitemap ?? []).map((u) => pathnameOf(u));
      const omittedFound = omitted.filter((o) => crawledNotInSitemapPaths.includes(o));
      const pass = hasGearRepair && failedCatches && omittedFound.length >= 2;
      push({
        id,
        expectation: exp,
        status: pass ? "PASS" : "FAIL",
        evidence: `hasGearRepair=${hasGearRepair}, sitemapEntriesFailed catches it=${failedCatches}, crawledNotInSitemap omissions found=[${omittedFound.join(", ")}]`,
      });
    }
  }

  // #15 — canonical mismatch, http:// internal link, www/non-www mix preserved.
  {
    const id = "15";
    const exp =
      "/blog/rain-gear-care canonical points at /products/cascade-rain-shell; >=1 internal link authored as http://; both www and non-www absolute internal links preserved";
    if (!full.found) push(na(id, exp, "target-full run not found"));
    else {
      const rainGear = byPath(full.pages, "/blog/rain-gear-care");
      const canonicalMismatch = pathnameOf(rainGear?.canonical ?? null) === "/products/cascade-rain-shell";
      const allLinks = full.pages.flatMap((p) => p.links);
      const hasHttp = allLinks.some((l) => l.type === "internal" && l.target.toLowerCase().startsWith("http://"));
      const hasWww = allLinks.some((l) => l.type === "internal" && /^https?:\/\/www\./i.test(l.target));
      const hasNonWww = allLinks.some(
        (l) => l.type === "internal" && /^https?:\/\/(?!www\.)/i.test(l.target) && l.target.includes("summittrailgear.example")
      );
      push({
        id,
        expectation: exp,
        status: canonicalMismatch && hasHttp && hasWww && hasNonWww ? "PASS" : "FAIL",
        evidence: `canonicalMismatch=${canonicalMismatch}, hasHttpLink=${hasHttp}, hasWwwLink=${hasWww}, hasNonWwwLink=${hasNonWww}`,
      });
    }
  }

  // #16 — redirect chain (2 hops) + redirect loop classification.
  {
    const id = "16";
    const exp = "/old-gear run shows a 2-hop redirectChain ending at /products; /loop-a run has a redirect-loop failure";
    if (!chain.found && !loop.found) push(na(id, exp, "redirect-chain and redirect-loop runs not found"));
    else {
      const chainPage = chain.found ? byPath(chain.pages, "/old-gear") : undefined;
      const chainOk = chainPage?.redirectChain.length === 2 && pathnameOf(chainPage.finalUrl) === "/products";
      const loopFailure = loop.found ? loop.failures.find((f) => f.reason === "redirect-loop") : undefined;
      const loopOk = Boolean(loopFailure);
      push({
        id,
        expectation: exp,
        status: chainOk && loopOk ? "PASS" : "FAIL",
        evidence: `chain: redirectChain.length=${chainPage?.redirectChain.length}, finalUrl=${chainPage?.finalUrl}; loop: failure found=${loopOk} (reason=${loopFailure?.reason})`,
      });
    }
  }

  // #17 — thin content on /blog/trail-snacks.
  {
    const id = "17";
    const exp = "/blog/trail-snacks content.wordCount < 80";
    if (!full.found) push(na(id, exp, "target-full run not found"));
    else {
      const p = byPath(full.pages, "/blog/trail-snacks");
      push({
        id,
        expectation: exp,
        status: p && p.content.wordCount < 80 ? "PASS" : "FAIL",
        evidence: `wordCount=${p?.content.wordCount}`,
      });
    }
  }

  // #18 — near-duplicate pair: winter checklist pages, wordCounts within 20% of each other.
  {
    const id = "18";
    const exp = "/blog/winter-hiking-checklist and /blog/winter-day-hike-checklist have near-identical wordCount (~90% similar content)";
    if (!full.found) push(na(id, exp, "target-full run not found"));
    else {
      const a = byPath(full.pages, "/blog/winter-hiking-checklist");
      const b = byPath(full.pages, "/blog/winter-day-hike-checklist");
      const wa = a?.content.wordCount ?? 0;
      const wb = b?.content.wordCount ?? 0;
      const within20pct = wa > 0 && wb > 0 && Math.abs(wa - wb) / Math.max(wa, wb) <= 0.2;
      push({
        id,
        expectation: exp,
        status: within20pct ? "PASS" : "FAIL",
        evidence: `wordCount a=${wa}, b=${wb}, contentHash a=${a?.content.contentHash}, b=${b?.content.contentHash} (schema has no similarity score — wordCount proximity is the crawler-level proxy; true near-dup scoring is POC-2's job)`,
      });
    }
  }

  return results;
}

interface SeededComment {
  file: string;
  line: number;
  text: string;
}

async function walk(dir: string): Promise<string[]> {
  let out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".next") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(await walk(full));
    else out.push(full);
  }
  return out;
}

async function grepSeededComments(): Promise<SeededComment[]> {
  const roots = [path.join(TARGET_SITE_DIR, "app"), path.join(TARGET_SITE_DIR, "public")];
  const files = (await Promise.all(roots.map(walk))).flat();
  files.push(path.join(TARGET_SITE_DIR, "next.config.ts"));
  const found: SeededComment[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = await readFile(file, "utf8");
    } catch {
      continue;
    }
    content.split(/\r?\n/).forEach((line, idx) => {
      if (/seeded/i.test(line)) {
        found.push({ file: path.relative(TARGET_SITE_DIR, file), line: idx + 1, text: line.trim() });
      }
    });
  }
  return found;
}

function toMarkdown(results: CheckResult[], seeded: SeededComment[], runIds: Record<string, string | null>): string {
  const lines: string[] = [];
  lines.push("# Seeded-evidence checklist (brief §6)");
  lines.push("");
  lines.push(`Runs used: ${Object.entries(runIds).map(([k, v]) => `${k}=${v ?? "N/A"}`).join(", ")}`);
  lines.push("");
  lines.push("| # | Expectation | Status | Evidence |");
  lines.push("|---|---|---|---|");
  for (const r of results) {
    lines.push(`| ${r.id} | ${r.expectation} | ${r.status} | ${r.evidence.replace(/\|/g, "\\|")} |`);
  }
  const failCount = results.filter((r) => r.status === "FAIL").length;
  const naCount = results.filter((r) => r.status === "N/A").length;
  lines.push("");
  lines.push(`**${results.length - failCount - naCount}/${results.length} PASS, ${failCount} FAIL, ${naCount} N/A**`);
  lines.push("");
  lines.push("## Seeded-comment source manifest (live grep of ../target-site)");
  lines.push("");
  lines.push("Reconstructed at check-run time from `seeded` comments in app/, public/, next.config.ts — not hardcoded.");
  lines.push("");
  for (const s of seeded) {
    lines.push(`- \`${s.file}:${s.line}\` — ${s.text.replace(/^\/\*|\*\/$|^\{\/\*|\*\/\}$|^\/\//g, "").trim()}`);
  }
  lines.push("");
  return lines.join("\n");
}

async function findLatestBenchDir(): Promise<string | null> {
  try {
    const entries = await readdir(BENCH_DIR, { withFileTypes: true });
    // Only manifest-bearing stamp dirs count — helper dirs like server-logs/ sort after
    // timestamp names and previously hijacked "latest" (the 18×N/A bug).
    const candidates: string[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dir = path.join(BENCH_DIR, e.name);
      try {
        await readFile(path.join(dir, "manifest.json"), "utf8");
        candidates.push(e.name);
      } catch {
        /* not a bench stamp dir */
      }
    }
    const last = candidates.sort().at(-1);
    return last ? path.join(BENCH_DIR, last) : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { "bench-dir": { type: "string" } } });
  const benchDir = values["bench-dir"] ? path.resolve(values["bench-dir"]) : await findLatestBenchDir();

  let runIds: Record<string, string | undefined> = {};
  if (benchDir) {
    try {
      const manifest = JSON.parse(await readFile(path.join(benchDir, "manifest.json"), "utf8"));
      for (const t of manifest.targets as { name: string; runId?: string; skipped: boolean }[]) {
        if (!t.skipped && t.runId) runIds[t.name] = t.runId;
      }
    } catch {
      console.warn(`could not read manifest.json in ${benchDir} — proceeding with no run data`);
    }
  } else {
    console.warn("no storage/bench/<stamp> directory found — all checks will be N/A. Run scripts/bench.ts first.");
  }

  const [full, robots, chain, loop] = await Promise.all([
    loadRun(runIds["target-full"]),
    loadRun(runIds["target-robots"]),
    loadRun(runIds["redirect-chain"]),
    loadRun(runIds["redirect-loop"]),
  ]);

  const results = runChecks(full, robots, chain, loop);
  const seeded = await grepSeededComments();
  const md = toMarkdown(results, seeded, {
    "target-full": full.runId,
    "target-robots": robots.runId,
    "redirect-chain": chain.runId,
    "redirect-loop": loop.runId,
  });

  console.log(md);

  const outDir = benchDir ?? path.join(BENCH_DIR, "no-run-data");
  await mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, "evidence.md");
  await writeFile(outFile, md, "utf8");
  console.log(`\nwritten to ${path.relative(PROJECT_ROOT, outFile)}`);

  const failCount = results.filter((r) => r.status === "FAIL").length;
  if (failCount > 0) {
    console.error(`${failCount} check(s) FAILED`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
