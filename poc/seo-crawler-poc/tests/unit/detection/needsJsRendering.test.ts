import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { needsJsRendering } from "../../../src/detection/needsJsRendering";
import { extraction, FAKE_SCOPE, link, wordCount } from "./helpers";

const load = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../fixtures/detection/${name}`, import.meta.url)), "utf-8");

// Reworked per the four-crawler escalation-heuristic audit: the prior 7-signal stack escalated on
// proxies (missing SEO tags, "tiny body" alone, bundler script src) that correlate weakly with
// real JS-dependency (21/24 escalations on the audited site gained nothing). Now exactly two
// signals, both direct DOM-emptiness evidence.
describe("needsJsRendering (reworked, two direct-evidence signals only)", () => {
  it("escalates a CSR app shell: empty #root + bundle script + near-zero page text", () => {
    const html = load("csr-app-shell.html");
    const result = needsJsRendering(html, extraction(""), FAKE_SCOPE);
    expect(result.needed).toBe(true);
    expect(result.signals).toEqual(["empty-framework-root"]);
  });

  it("never escalates a content-rich SSR page with real nav links", () => {
    const html = load("rich-ssr-blog.html");
    const text = html.replace(/<[^>]+>/g, " ");
    const ext = extraction(text, [
      link("https://example.test/", "internal"),
      link("https://example.test/guides", "internal"),
      link("https://example.test/gear", "internal"),
    ]);
    const result = needsJsRendering(html, ext, FAKE_SCOPE);
    expect(result.needed).toBe(false);
    expect(result.signals).toEqual([]);
  });

  it("does not escalate an example.com-shaped tiny page with real text and one external link", () => {
    const html = load("tiny-static-example.html");
    const text =
      "Example Domain This domain is established to be used for illustrative examples in " +
      "documents without prior coordination or asking for permission. It may be used in " +
      "literature without needing to request permission from anyone in advance, as long as " +
      "proper attribution to this domain is provided wherever it is referenced or cited within " +
      "any given work or context. More information...";
    expect(wordCount(text)).toBeGreaterThanOrEqual(30);
    const ext = extraction(text, [link("https://www.iana.org/domains/example", "external")]);
    const result = needsJsRendering(html, ext, FAKE_SCOPE);
    expect(result.needed).toBe(false);
  });

  // Behavior change (deliberate): a noscript "enable JavaScript" warning is no longer, by itself,
  // an escalation signal. The rework's mandate is "escalate only on evidence of a JS-dependent
  // DOM" via exactly the two signals below — this page has real extracted text/links and neither
  // signal's conditions hold, so it now reads as a static-enough page. If real-world calibration
  // later shows noscript warnings are worth restoring as a third direct-evidence signal, that's a
  // one-line addition, not a design reversal.
  it("does not escalate on a noscript warning alone when static content/links are already real", () => {
    const html = load("noscript-warning.html");
    const text =
      "Welcome back Your account overview is ready. Recent activity, notifications, and quick " +
      "actions are all available from this page once the application has finished loading in " +
      "your browser.";
    const ext = extraction(text, [
      link("https://example.test/dashboard", "internal"),
      link("https://example.test/settings", "internal"),
    ]);
    const result = needsJsRendering(html, ext, FAKE_SCOPE);
    expect(result.needed).toBe(false);
  });

  // Behavior change (deliberate, and an improvement): a body that is empty but has NO script at
  // all cannot be fixed by a browser render — there is no JS to execute. The old "tiny-body"
  // signal escalated on emptiness alone, paying for a render that could never help. This page has
  // no framework mount marker and no <script>, so neither signal fires.
  it("does not escalate a truly empty 200 response with no script to run", () => {
    const html = load("empty-body.html");
    const result = needsJsRendering(html, extraction(""), FAKE_SCOPE);
    expect(result.needed).toBe(false);
  });

  it("does not escalate a borderline sparse landing page (real text, real nav, no script)", () => {
    const html = load("borderline-sparse-landing.html");
    const text =
      "Welcome to Acme Co We build small tools for busy teams who want less setup and fewer " +
      "moving parts. Browse our products, learn about our story, or get in touch if you have " +
      "questions about what we offer or how to get started this week.";
    expect(wordCount(text)).toBeGreaterThanOrEqual(30);
    const ext = extraction(text, [
      link("https://example.test/products", "internal"),
      link("https://example.test/about", "internal"),
      link("https://example.test/contact", "internal"),
    ]);
    const result = needsJsRendering(html, ext, FAKE_SCOPE);
    expect(result.needed).toBe(false);
    expect(result.signals).toEqual([]);
  });

  it("escalates a minimal bundle-script-only shell via sparse-js-heavy-dom", () => {
    const html = '<html><head></head><body><script src="/assets/main.deadbeef.js"></script></body></html>';
    const result = needsJsRendering(html, extraction(""), FAKE_SCOPE);
    expect(result.needed).toBe(true);
    expect(result.signals).toEqual(["sparse-js-heavy-dom"]);
  });

  it("both signals can fire together and both are listed", () => {
    // A framework mount root AND a script-dominant body with zero internal links.
    const html =
      '<html><head></head><body><div id="root"></div><script src="/assets/main.deadbeef.js"></script></body></html>';
    const result = needsJsRendering(html, extraction(""), FAKE_SCOPE);
    expect(result.needed).toBe(true);
    expect(result.signals).toEqual(expect.arrayContaining(["empty-framework-root", "sparse-js-heavy-dom"]));
    expect(result.signals).toHaveLength(2);
  });
});

// Regression tracker (was: "real quotes.toscrape.com/js capture"). Real numbers measured against
// the fixture: totalBytes 5808, textBytes 98 (textRatio 0.017 < 0.05), scriptBytes 4516 (46x
// textBytes, > the 3x bar) — signal [B]'s text/script conditions are both clearly true. The ONLY
// reason this no longer escalates is the fixture's 3 real static internal links (home/login/next)
// against the spec's strict "<3" bar. This is a KNOWN, accepted tradeoff of the rework's exact
// numeric spec, not an oversight — flagged in the handoff report so the threshold can be loosened
// (e.g. <=3) if real-world calibration on the actual target site shows it matters there too.
describe("real quotes.toscrape.com/js capture (known accepted tradeoff)", () => {
  it("no longer escalates the real inline-data CSR shell — 3 internal links misses the <3 bar", () => {
    const html = load("quotes-js-real.html");
    const ext = extraction("Quotes to Scrape Login", [
      link("https://quotes.toscrape.com/login", "internal"),
      link("https://quotes.toscrape.com/js/page/2", "internal"),
      link("https://quotes.toscrape.com/", "internal"),
    ]);
    const verdict = needsJsRendering(html, ext, FAKE_SCOPE);
    expect(verdict.needed).toBe(false);
    expect(verdict.signals).toEqual([]);
  });

  it("WOULD escalate the same page if it had one fewer internal link (isolates the link-count bar)", () => {
    const html = load("quotes-js-real.html");
    const ext = extraction("Quotes to Scrape Login", [
      link("https://quotes.toscrape.com/login", "internal"),
      link("https://quotes.toscrape.com/js/page/2", "internal"),
    ]);
    const verdict = needsJsRendering(html, ext, FAKE_SCOPE);
    expect(verdict.needed).toBe(true);
    expect(verdict.signals).toEqual(["sparse-js-heavy-dom"]);
  });
});
