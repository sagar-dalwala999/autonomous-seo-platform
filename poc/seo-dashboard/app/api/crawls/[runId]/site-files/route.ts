import { NextResponse } from "next/server";
import { getRun } from "@/lib/data";
import { isSafeId, badRequest, notFound } from "@/lib/api-shared";
import { requireApiSession } from "@/lib/auth-guard";

/** GET /crawls/:id/site-files — robots.txt + sitemap ladder + llms.txt + feeds + favicon +
 *  manifest (spec §7). robots.json/sitemaps.json are real, on disk — including the llms.txt
 *  evidence carried on robots.json (metadata, plus the body from the content-storing crawler
 *  version on). Feed discovery and favicon/manifest probing are not captured anywhere in this
 *  run's stored artifacts yet — marked unavailable rather than guessed. */
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const { runId } = await params;
  if (!isSafeId(runId)) return badRequest("Invalid runId.");
  const { report, robots, sitemaps } = await getRun(runId);
  if (!report) return notFound(`No completed run found for "${runId}".`);

  return NextResponse.json({
    robots: robots
      ? { url: robots.url, statusCode: robots.statusCode, content: robots.content, sitemaps: robots.sitemaps, parseStatus: robots.parseStatus, fetchedAt: robots.fetchedAt, available: true }
      : { available: false, reason: "robots.json not found for this run." },
    sitemaps: sitemaps
      ? { entries: sitemaps.entries, files: sitemaps.files, errors: sitemaps.errors, available: true }
      : { available: false, reason: "sitemaps.json not found for this run." },
    llmsTxt: robots?.llmsTxt
      ? {
          available: true,
          present: robots.llmsTxt.present,
          url: robots.llmsTxt.url,
          statusCode: robots.llmsTxt.statusCode,
          bytes: robots.llmsTxt.bytes,
          fetchedAt: robots.llmsTxt.fetchedAt,
          content: robots.llmsTxt.content ?? null,
        }
      : { available: false, reason: "llms.txt was not probed for this run (robots.json carries no llmsTxt field)." },
    feeds: { available: false, reason: "Feed discovery (<link rel=alternate>, /feed, /rss.xml, ...) is not stored on the run yet." },
    favicon: { available: false, reason: "Favicon resolution ladder is captured per-page (page.favicons) but not aggregated at the run level yet." },
    webManifest: { available: false, reason: "Web app manifest is not probed/stored by the crawler yet." },
  });
}
