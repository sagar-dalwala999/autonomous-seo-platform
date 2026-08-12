import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { needsJsRendering } from "../../../src/detection/needsJsRendering";
import { extraction, FAKE_SCOPE, link, wordCount } from "./helpers";

const load = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../fixtures/detection/${name}`, import.meta.url)), "utf-8");

describe("needsJsRendering (plan §18)", () => {
  it("escalates a CSR app shell: empty #root + bundle script + no extracted content", () => {
    const html = load("csr-app-shell.html");
    const result = needsJsRendering(html, extraction(""), FAKE_SCOPE);
    expect(result.needed).toBe(true);
    expect(result.signals).toContain("empty-app-shell");
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
    expect(result.signals).not.toContain("empty-app-shell");
    expect(result.signals).not.toContain("noscript-warning");
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

  it("escalates on a noscript 'enable JavaScript' warning even with real content and links", () => {
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
    expect(result.needed).toBe(true);
    expect(result.signals).toContain("noscript-warning");
  });

  it("escalates an empty-body 200 response", () => {
    const html = load("empty-body.html");
    const result = needsJsRendering(html, extraction(""), FAKE_SCOPE);
    expect(result.needed).toBe(true);
    expect(result.signals).toContain("tiny-body");
    expect(result.signals).toContain("no-links-no-text");
  });

  it("does not escalate a borderline sparse landing page (single weak signal insufficient)", () => {
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
    expect(result.signals.length).toBeLessThanOrEqual(1);
  });

  it("signals array always lists every fired signal, not just the deciding ones", () => {
    // Deliberately trip tiny-body + no-links-no-text + spa-bundle-only together.
    const html =
      '<html><head></head><body><script src="/assets/main.deadbeef.js"></script></body></html>';
    const result = needsJsRendering(html, extraction(""), FAKE_SCOPE);
    expect(result.signals).toEqual(
      expect.arrayContaining(["tiny-body", "no-links-no-text", "spa-bundle-only"]),
    );
    expect(result.needed).toBe(true);
  });
});

// Regression: S4's live crawl saw needed:false on this exact real-world page (razor-thin
// low-text-ratio). script-dominant must make the verdict robust to that edge.
describe("real quotes.toscrape.com/js capture", () => {
  it("escalates the real inline-data CSR shell via script-dominant", () => {
    const html = load("quotes-js-real.html");
    const ext = extraction("Quotes to Scrape Login", [
      link("https://quotes.toscrape.com/login", "internal"),
      link("https://quotes.toscrape.com/js/page/2", "internal"),
      link("https://quotes.toscrape.com/", "internal"),
    ]);
    const verdict = needsJsRendering(html, ext, FAKE_SCOPE);
    expect(verdict.needed).toBe(true);
    expect(verdict.signals).toContain("script-dominant");
    expect(verdict.signals).toContain("tiny-body");
  });
});
