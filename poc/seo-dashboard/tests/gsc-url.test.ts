import { describe, it, expect } from "vitest";
import { normalizeUrl, toJoinKey, normalizeDomain, propertyMatchesDomain, propertyTypeOf } from "../lib/gsc/url";

describe("normalizeUrl", () => {
  it("strips the trailing slash from a path (the crawl join-key contract)", () => {
    expect(normalizeUrl("https://site.com/post/xyz/")).toBe("https://site.com/post/xyz");
  });

  it("keeps the root trailing slash", () => {
    expect(normalizeUrl("https://site.com/")).toBe("https://site.com/");
  });

  it("drops tracking params and sorts the rest deterministically", () => {
    expect(normalizeUrl("https://site.com/p?utm_source=x&b=2&a=1&gclid=abc")).toBe("https://site.com/p?a=1&b=2");
  });

  it("lowercases the host", () => {
    expect(normalizeUrl("https://SITE.com/Page")).toBe("https://site.com/Page");
  });

  it("returns null for non-http(s) schemes and garbage", () => {
    expect(normalizeUrl("mailto:a@b.com")).toBeNull();
    expect(normalizeUrl("not a url")).toBeNull();
  });
});

describe("toJoinKey", () => {
  it("reduces a GSC-reported URL to the same key the crawler stores", () => {
    // Google reports with a trailing slash; the crawler stores without one.
    expect(toJoinKey("https://site.com/post/xyz/")).toBe("https://site.com/post/xyz");
  });
});

describe("normalizeDomain", () => {
  it("strips protocol, www and port", () => {
    expect(normalizeDomain("https://www.Example.com:3000/path")).toBe("example.com");
  });

  it("handles a bare domain", () => {
    expect(normalizeDomain("example.com")).toBe("example.com");
  });
});

describe("propertyMatchesDomain", () => {
  it("matches a domain property against the bare host", () => {
    expect(propertyMatchesDomain("sc-domain:example.com", "www.example.com")).toBe(true);
  });

  it("matches a url-prefix property host", () => {
    expect(propertyMatchesDomain("https://example.com/", "example.com")).toBe(true);
  });

  it("rejects a different domain", () => {
    expect(propertyMatchesDomain("sc-domain:other.com", "example.com")).toBe(false);
  });
});

describe("propertyTypeOf", () => {
  it("classifies domain vs url-prefix properties", () => {
    expect(propertyTypeOf("sc-domain:example.com")).toBe("domain");
    expect(propertyTypeOf("https://example.com/")).toBe("url_prefix");
  });
});
