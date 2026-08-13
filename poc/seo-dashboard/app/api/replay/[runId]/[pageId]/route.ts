import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { runsDir } from "@/lib/data";

// Same rules as app/api/raw's route: dots are legal in ids, so ".." alone passes a charset
// check and escapes via path.join — the dot-segment rejection + containment assert are both
// load-bearing here too. Duplicated rather than imported to avoid touching lib/data.ts.
const SAFE_ID = /^[a-zA-Z0-9_.-]+$/;

function isSafeId(id: string): boolean {
  return SAFE_ID.test(id) && id !== "." && id !== "..";
}

// Generous for a single captured page; keeps the blob/srcdoc payload (and this JSON response) sane.
const MAX_BYTES = 2_000_000;

/** Offline: nothing loads at all. Faithful to the capture, but an asset-heavy page renders as
 *  meaningless grey boxes, which is not a preview anyone can read. */
const CSP_OFFLINE =
  "default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; " +
  "media-src 'none'; object-src 'none'; frame-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none';";

/** Styled: stylesheets, images and fonts load from the live origin so the page LOOKS like itself.
 *  script-src stays 'none' — no execution means no exfiltration and no dynamic rewriting, which is
 *  the property that actually matters. base-uri is omitted because we inject our own <base>. */
const CSP_STYLED =
  "default-src 'none'; script-src 'none'; style-src * 'unsafe-inline'; img-src * data: blob:; " +
  "font-src * data:; media-src *; object-src 'none'; frame-src 'none'; connect-src 'none'; form-action 'none';";

// CSP's fetch directives stop subresource *loads* but not a same-frame link click or a
// meta-refresh timer navigating the iframe to a live URL — neutralize those two vectors directly.
// \b keeps this off "hreflang" while still catching "xlink:href".
function neutralizeNavigation(html: string): string {
  let out = html.replace(/\bhref(\s*=\s*(?:"[^"]*"|'[^']*'))/gi, "data-original-href$1");
  out = out.replace(/<meta((?:\s+[a-z-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>/gi, (tag, attrs: string) =>
    /http-equiv\s*=\s*["']?refresh["']?/i.test(attrs) ? tag.replace(/\bhttp-equiv\b/i, "data-http-equiv-disabled") : tag,
  );
  return out;
}

// Belt-and-suspenders alongside the iframe's sandbox attribute: this covers absolute-URL
// subresources even if the captured markup is malformed enough to dodge the head/html fallback.
/** Relative asset paths only resolve if the frame knows where the page came from. */
function injectHead(html: string, csp: string, baseHref: string | null): string {
  const metaTag =
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    (baseHref ? `<base href="${baseHref.replace(/"/g, "&quot;")}">` : "");
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${metaTag}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html([^>]*)>/i, `<html$1><head>${metaTag}</head>`);
  return `${metaTag}${html}`;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ runId: string; pageId: string }> }) {
  const { runId, pageId } = await params;
  if (!isSafeId(runId) || !isSafeId(pageId)) {
    return Response.json({ error: "Invalid run or page id" }, { status: 400 });
  }

  const variant = req.nextUrl.searchParams.get("variant") === "static" ? "static" : "rendered";
  const styled = req.nextUrl.searchParams.get("assets") === "live";
  const filename = variant === "static" ? `${pageId}.static.html` : `${pageId}.html`;
  const filePath = path.join(runsDir(), runId, "raw", filename);

  // Final containment check: whatever the id rules allow, the resolved file must live under the
  // runs directory. Survives any future change to how the path is built.
  const resolved = path.resolve(filePath);
  const root = path.resolve(runsDir());
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return Response.json({ error: "Invalid run or page id" }, { status: 400 });
  }

  try {
    await stat(filePath);
  } catch {
    return Response.json({ error: "No stored HTML for this page/variant", variant }, { status: 404 });
  }

  const raw = await readFile(filePath, "utf8");
  const rawBuf = Buffer.from(raw, "utf8");
  const originalByteLength = rawBuf.byteLength;
  const truncated = originalByteLength > MAX_BYTES;
  // A byte-boundary cut can land mid multi-byte UTF-8 char; Node decodes the dangling tail as
  // U+FFFD, which re-encodes to a different length than the cap. Drop it rather than report a
  // byteLength that doesn't match what was actually cut.
  const sliced = truncated ? rawBuf.subarray(0, MAX_BYTES).toString("utf8").replace(/�$/, "") : raw;

  // Styled mode needs the page's own URL as the resolution base for its relative assets.
  let baseHref: string | null = null;
  if (styled) {
    try {
      const rec = JSON.parse(await readFile(path.join(runsDir(), runId, "pages", `${pageId}.json`), "utf8"));
      baseHref = rec.finalUrl ?? rec.url ?? null;
    } catch {
      baseHref = null; // no record — fall back to offline behaviour rather than guessing an origin
    }
  }

  const html = injectHead(neutralizeNavigation(sliced), styled && baseHref ? CSP_STYLED : CSP_OFFLINE, baseHref);

  return Response.json({
    variant,
    styled: Boolean(styled && baseHref),
    baseHref,
    html,
    empty: originalByteLength === 0,
    truncated,
    maxBytes: MAX_BYTES,
    byteLength: Buffer.byteLength(sliced, "utf8"),
    originalByteLength,
  });
}
