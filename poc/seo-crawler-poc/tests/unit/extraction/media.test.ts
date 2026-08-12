import { describe, it, expect } from "vitest";
import * as cheerio from "cheerio";
import { extractVideos } from "../../../src/extraction/media";
import { loadFixture } from "./testUtils";

const BASE = "https://summittrailgear.example/guides/trail-videos";

describe("extractVideos", () => {
  it("captures <video src>, multi-<source>, poster, YouTube (3 URL shapes), Vimeo; excludes non-video iframe", () => {
    const $ = cheerio.load(loadFixture("media-mixed.html"));
    const videos = extractVideos($, BASE);
    expect(videos).toHaveLength(7);

    const [introFile, webmSource, mp4Source, ytEmbed, ytNoCookie, ytShort, vimeo] = videos;

    expect(introFile!.kind).toBe("file");
    expect(introFile!.url).toBe("https://summittrailgear.example/media/intro.mp4");
    expect(introFile!.poster).toBe("https://summittrailgear.example/media/intro-poster.jpg");
    expect(introFile!.mimeType).toBeNull();
    expect(introFile!.providerId).toBeNull();

    // both <source> children share the parent <video>'s relative poster, resolved against base
    expect(webmSource!.url).toBe("https://summittrailgear.example/media/hike-1080.webm");
    expect(webmSource!.mimeType).toBe("video/webm");
    expect(webmSource!.poster).toBe("https://summittrailgear.example/guides/fallback-poster.jpg");
    expect(webmSource!.kind).toBe("file");

    expect(mp4Source!.url).toBe("https://summittrailgear.example/media/hike-720.mp4");
    expect(mp4Source!.mimeType).toBe("video/mp4");
    expect(mp4Source!.poster).toBe("https://summittrailgear.example/guides/fallback-poster.jpg");

    expect(ytEmbed!.kind).toBe("youtube");
    expect(ytEmbed!.providerId).toBe("dQw4w9WgXcQ");
    expect(ytEmbed!.poster).toBeNull();

    expect(ytNoCookie!.kind).toBe("youtube");
    expect(ytNoCookie!.providerId).toBe("M7lc1UVf-VE");

    expect(ytShort!.kind).toBe("youtube");
    expect(ytShort!.providerId).toBe("oHg5SJYRHA0");

    expect(vimeo!.kind).toBe("vimeo");
    expect(vimeo!.providerId).toBe("76979871");
    expect(vimeo!.mimeType).toBeNull();

    // the maps iframe is neither youtube/vimeo nor "video"-ish — must not appear at all
    expect(videos.some((v) => v.url.includes("google.com/maps"))).toBe(false);
  });

  it("resolves a relative <video src> against base", () => {
    const $ = cheerio.load(`<video src="clip.mp4"></video>`);
    expect(extractVideos($, BASE)[0]!.url).toBe("https://summittrailgear.example/guides/clip.mp4");
  });

  it("excludes an iframe with no video/provider signal in its src", () => {
    const $ = cheerio.load(`<iframe src="https://www.google.com/maps/embed?pb=x"></iframe>`);
    expect(extractVideos($, BASE)).toEqual([]);
  });

  it("buckets an unrecognized-but-video-ish embed (e.g. Dailymotion) as kind iframe with null providerId", () => {
    const $ = cheerio.load(`<iframe src="https://www.dailymotion.com/embed/video/x2abc"></iframe>`);
    const videos = extractVideos($, BASE);
    expect(videos).toHaveLength(1);
    expect(videos[0]!.kind).toBe("iframe");
    expect(videos[0]!.providerId).toBeNull();
  });

  it("skips data: and blob: sources on both <video> and <iframe>", () => {
    const $ = cheerio.load(
      `<video src="data:video/mp4;base64,AAAA"></video><iframe src="blob:https://summittrailgear.example/1"></iframe>`
    );
    expect(extractVideos($, BASE)).toEqual([]);
  });

  it("dedupes identical resolved source URLs on a single <video>", () => {
    const $ = cheerio.load(`<video src="/media/a.mp4"><source src="/media/a.mp4" type="video/mp4"></video>`);
    expect(extractVideos($, BASE)).toHaveLength(1);
  });

  it("skips <video>/<iframe> tags with no src at all", () => {
    const $ = cheerio.load(`<video></video><iframe></iframe>`);
    expect(extractVideos($, BASE)).toEqual([]);
  });

  it("never throws on malformed markup (unclosed video/source/iframe tags)", () => {
    const $ = cheerio.load(
      `<video src="/media/x.mp4"><source src="/media/y.mp4"><iframe src="https://youtu.be/abc123def"`
    );
    expect(() => extractVideos($, BASE)).not.toThrow();
  });

  it("never throws on an unresolvable src", () => {
    const $ = cheerio.load(`<video src="http://[bad"></video>`);
    expect(() => extractVideos($, BASE)).not.toThrow();
    expect(extractVideos($, BASE)).toEqual([]);
  });
});
