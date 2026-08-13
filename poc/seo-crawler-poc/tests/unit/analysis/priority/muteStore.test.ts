import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSiteMutes, muteRule, siteKeyFromStartUrl, unmuteRule } from "../../../../src/analysis/priority/muteStore";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function tmp(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), "mutestore-"));
  dirs.push(d);
  return d;
}

describe("siteKeyFromStartUrl", () => {
  it("is the host (survives re-crawls of the same site with different paths)", () => {
    expect(siteKeyFromStartUrl("https://books.toscrape.com/catalogue/page-3.html")).toBe("books.toscrape.com");
    expect(siteKeyFromStartUrl("https://books.toscrape.com/")).toBe("books.toscrape.com");
  });

  it("includes the port, so different local fixture targets are different sites", () => {
    expect(siteKeyFromStartUrl("http://localhost:3105/")).toBe("localhost:3105");
    expect(siteKeyFromStartUrl("http://localhost:3106/")).toBe("localhost:3106");
  });

  it("returns null for a missing or unparsable startUrl, never throws", () => {
    expect(siteKeyFromStartUrl(null)).toBeNull();
    expect(siteKeyFromStartUrl(undefined)).toBeNull();
    expect(siteKeyFromStartUrl("not a url")).toBeNull();
  });
});

describe("muteRule / loadSiteMutes / unmuteRule", () => {
  it("round-trips: unmuted -> muted -> visible in loadSiteMutes -> unmuted -> gone", async () => {
    const storageRoot = await tmp();
    expect((await loadSiteMutes(storageRoot, "ex.com")).size).toBe(0);

    await muteRule(storageRoot, "ex.com", "title-missing", { note: "accepted for now" });
    const mutes = await loadSiteMutes(storageRoot, "ex.com");
    expect(mutes.has("title-missing")).toBe(true);
    expect(mutes.get("title-missing")!.note).toBe("accepted for now");

    await unmuteRule(storageRoot, "ex.com", "title-missing");
    expect((await loadSiteMutes(storageRoot, "ex.com")).size).toBe(0);
  });

  it("is keyed per site — muting on one host never affects another", async () => {
    const storageRoot = await tmp();
    await muteRule(storageRoot, "site-a.com", "h1-missing");
    const a = await loadSiteMutes(storageRoot, "site-a.com");
    const b = await loadSiteMutes(storageRoot, "site-b.com");
    expect(a.has("h1-missing")).toBe(true);
    expect(b.has("h1-missing")).toBe(false);
  });

  it("re-muting the same rule replaces (not duplicates) the record", async () => {
    const storageRoot = await tmp();
    await muteRule(storageRoot, "ex.com", "r1", { note: "first" });
    await muteRule(storageRoot, "ex.com", "r1", { note: "second" });
    const mutes = await loadSiteMutes(storageRoot, "ex.com");
    expect(mutes.size).toBe(1);
    expect(mutes.get("r1")!.note).toBe("second");
  });

  it("an expired mute is treated as not-muted", async () => {
    const storageRoot = await tmp();
    await muteRule(storageRoot, "ex.com", "r1", { expiresAt: "2020-01-01T00:00:00.000Z" });
    const mutes = await loadSiteMutes(storageRoot, "ex.com");
    expect(mutes.has("r1")).toBe(false);
  });

  it("loadSiteMutes on a site with no mute file returns an empty map, never throws", async () => {
    const storageRoot = await tmp();
    await expect(loadSiteMutes(storageRoot, "never-muted.com")).resolves.toEqual(new Map());
  });

  it("a null site key always yields no mutes", async () => {
    const storageRoot = await tmp();
    await muteRule(storageRoot, "ex.com", "r1");
    expect((await loadSiteMutes(storageRoot, null)).size).toBe(0);
  });
});
