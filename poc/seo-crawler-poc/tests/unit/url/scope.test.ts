import { describe, expect, it } from "vitest";
import { deriveScope, isInScope, remapAliasedUrl, uniqueKeyFor } from "../../../src/url/scope";
import { normalizeUrl } from "../../../src/url/normalize";

describe("deriveScope", () => {
  it("uses registrable domain for a normal domain", () => {
    const scope = deriveScope("https://example.com/start");
    expect(scope.registrableDomain).toBe("example.com");
    expect(scope.fallbackHost).toBeNull();
    expect(scope.seedOrigin).toBe("https://example.com");
    expect(scope.seedUrl).toBe("https://example.com/start");
  });

  it("falls back to exact host[:port] for localhost", () => {
    const scope = deriveScope("http://localhost:3105/");
    expect(scope.registrableDomain).toBe("");
    expect(scope.fallbackHost).toBe("localhost:3105");
    expect(scope.seedOrigin).toBe("http://localhost:3105");
  });

  it("falls back to exact host for a bare IP", () => {
    const scope = deriveScope("http://127.0.0.1:8080/");
    expect(scope.registrableDomain).toBe("");
    expect(scope.fallbackHost).toBe("127.0.0.1:8080");
  });

  it("lowercases and dedupes hostAliases", () => {
    const scope = deriveScope("http://localhost:3105/", [
      "SummitTrailGear.example",
      "summittrailgear.example",
      " www.summittrailgear.example ",
    ]);
    expect(scope.hostAliases).toEqual(["summittrailgear.example", "www.summittrailgear.example"]);
  });

  it("throws on an invalid start URL rather than silently producing a broken scope", () => {
    expect(() => deriveScope("not a url")).toThrow();
  });
});

describe("isInScope", () => {
  it("treats any subdomain / www / scheme / port as in-scope for a registrable domain", () => {
    const scope = deriveScope("https://example.com/");
    expect(isInScope(normalizeUrl("https://example.com/x")!, scope)).toBe(true);
    expect(isInScope(normalizeUrl("https://www.example.com/x")!, scope)).toBe(true);
    expect(isInScope(normalizeUrl("http://www.example.com/x")!, scope)).toBe(true);
    expect(isInScope(normalizeUrl("https://sub.example.com/x")!, scope)).toBe(true);
    expect(isInScope(normalizeUrl("https://example.com:8443/x")!, scope)).toBe(true);
  });

  it("rejects a different registrable domain", () => {
    const scope = deriveScope("https://example.com/");
    expect(isInScope(normalizeUrl("https://other.com/x")!, scope)).toBe(false);
    expect(isInScope(normalizeUrl("https://notexample.com/x")!, scope)).toBe(false);
  });

  it("requires exact host:port match for the fallbackHost (localhost) case", () => {
    const scope = deriveScope("http://localhost:3105/");
    expect(isInScope(normalizeUrl("http://localhost:3105/page")!, scope)).toBe(true);
    expect(isInScope(normalizeUrl("http://localhost:3000/page")!, scope)).toBe(false);
    expect(isInScope(normalizeUrl("http://127.0.0.1:3105/page")!, scope)).toBe(false);
  });

  it("treats aliased hosts and their www-variant as in-scope", () => {
    const scope = deriveScope("http://localhost:3105/", ["summittrailgear.example"]);
    expect(isInScope(normalizeUrl("https://summittrailgear.example/products/x")!, scope)).toBe(true);
    // www-variant of a listed alias is in-scope even though only the bare host was listed.
    expect(isInScope(normalizeUrl("https://www.summittrailgear.example/y")!, scope)).toBe(true);
    expect(isInScope(normalizeUrl("https://unrelated.example/y")!, scope)).toBe(false);
  });
});

describe("remapAliasedUrl", () => {
  it("rewrites scheme+host+port of an aliased-host URL onto the seed origin, preserving path/query", () => {
    const scope = deriveScope("http://localhost:3105/", [
      "summittrailgear.example",
      "www.summittrailgear.example",
    ]);
    expect(remapAliasedUrl(normalizeUrl("https://summittrailgear.example/products/x")!, scope)).toBe(
      "http://localhost:3105/products/x",
    );
    expect(
      remapAliasedUrl(normalizeUrl("https://www.summittrailgear.example/y?q=1")!, scope),
    ).toBe("http://localhost:3105/y?q=1");
  });

  it("remaps a www-variant even when only the bare alias host was configured", () => {
    const scope = deriveScope("http://localhost:3105/", ["summittrailgear.example"]);
    expect(remapAliasedUrl(normalizeUrl("https://www.summittrailgear.example/z")!, scope)).toBe(
      "http://localhost:3105/z",
    );
  });

  it("passes non-aliased URLs through unchanged", () => {
    const scope = deriveScope("http://localhost:3105/", ["summittrailgear.example"]);
    const url = normalizeUrl("http://localhost:3105/other-page")!;
    expect(remapAliasedUrl(url, scope)).toBe(url);
    const external = normalizeUrl("https://unrelated.example/page")!;
    expect(remapAliasedUrl(external, scope)).toBe(external);
  });
});

describe("uniqueKeyFor", () => {
  it("is the normalized URL itself — normalization already IS the dedup identity", () => {
    const url = normalizeUrl("https://example.com/page")!;
    expect(uniqueKeyFor(url)).toBe(url);
  });
});
