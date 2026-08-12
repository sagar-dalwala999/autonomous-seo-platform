import { describe, expect, it } from "vitest";
import { normalizeUrl } from "../../../src/url/normalize";

describe("normalizeUrl — canonical identity (plan §6)", () => {
  it("collapses absolute, relative, fragment, and case variants to one identity", () => {
    const canonical = "https://example.com/page";
    expect(normalizeUrl("https://example.com/page")).toBe(canonical);
    expect(normalizeUrl("/page/", "https://example.com")).toBe(canonical);
    expect(normalizeUrl("https://example.com/page#section")).toBe(canonical);
    expect(normalizeUrl("https://EXAMPLE.com/page")).toBe(canonical);
    expect(normalizeUrl("https://example.com/page/")).toBe(canonical);
  });

  it("resolves relative hrefs against base", () => {
    expect(normalizeUrl("../up", "https://example.com/dir/page")).toBe("https://example.com/up");
    expect(normalizeUrl("child", "https://example.com/dir/")).toBe("https://example.com/dir/child");
    expect(normalizeUrl("//other.com/x", "https://example.com/")).toBe("https://other.com/x");
  });

  it("preserves root path trailing slash but strips it everywhere else", () => {
    expect(normalizeUrl("https://example.com")).toBe("https://example.com/");
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com/");
    expect(normalizeUrl("https://example.com/a/b/")).toBe("https://example.com/a/b");
  });

  it("strips default ports but preserves non-default ports", () => {
    expect(normalizeUrl("http://example.com:80/page")).toBe("http://example.com/page");
    expect(normalizeUrl("https://example.com:443/page")).toBe("https://example.com/page");
    expect(normalizeUrl("http://localhost:3105/page")).toBe("http://localhost:3105/page");
    expect(normalizeUrl("http://localhost:3000/page")).toBe("http://localhost:3000/page");
  });

  it("strips tracking params but keeps real ones", () => {
    expect(normalizeUrl("https://example.com/page?utm_source=x&utm_campaign=y&id=5")).toBe(
      "https://example.com/page?id=5",
    );
    expect(normalizeUrl("https://example.com/page?gclid=abc")).toBe("https://example.com/page");
    expect(normalizeUrl("https://example.com/page?fbclid=abc")).toBe("https://example.com/page");
    expect(normalizeUrl("https://example.com/page?msclkid=abc")).toBe("https://example.com/page");
    expect(normalizeUrl("https://example.com/page?ref=homepage")).toBe("https://example.com/page");
    // "ref" is stripped exactly; a param merely starting with "ref" is real content and must survive.
    expect(normalizeUrl("https://example.com/page?refund=true")).toBe(
      "https://example.com/page?refund=true",
    );
  });

  it("stable-sorts remaining query params and collapses exact duplicates", () => {
    expect(normalizeUrl("https://example.com/page?b=2&a=1")).toBe("https://example.com/page?a=1&b=2");
    expect(normalizeUrl("https://example.com/page?a=1&b=2")).toBe("https://example.com/page?a=1&b=2");
    expect(normalizeUrl("https://example.com/page?a=1&a=1&b=2")).toBe(
      "https://example.com/page?a=1&b=2",
    );
    // Same key, different value is NOT a duplicate — both survive, deterministically ordered.
    expect(normalizeUrl("https://example.com/page?tag=y&tag=x")).toBe(
      "https://example.com/page?tag=x&tag=y",
    );
  });

  it("normalizes percent-encoding consistently via the URL API", () => {
    // A raw unsafe char and its pre-escaped form must converge to the same identity.
    expect(normalizeUrl("https://example.com/a b")).toBe(normalizeUrl("https://example.com/a%20b"));
    // Idempotent: re-normalizing an already-normalized URL is a no-op.
    const once = normalizeUrl("https://example.com/a%20b?x=1")!;
    expect(normalizeUrl(once)).toBe(once);
  });

  it("rejects non-http(s) schemes", () => {
    expect(normalizeUrl("mailto:a@b.com")).toBeNull();
    expect(normalizeUrl("tel:+15551234567")).toBeNull();
    expect(normalizeUrl("javascript:void(0)")).toBeNull();
    expect(normalizeUrl("data:text/plain,hi")).toBeNull();
    expect(normalizeUrl("ftp://example.com/file")).toBeNull();
  });

  it("returns null for malformed or empty input instead of throwing", () => {
    expect(normalizeUrl("")).toBeNull();
    expect(normalizeUrl("   ")).toBeNull();
    expect(normalizeUrl("not a url at all")).toBeNull();
    expect(() => normalizeUrl("not a url at all")).not.toThrow();
    expect(normalizeUrl("/relative-with-no-base")).toBeNull();
  });
});
