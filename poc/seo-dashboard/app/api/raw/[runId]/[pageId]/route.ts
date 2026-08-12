import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { rawHtmlPath, runsDir } from "@/lib/data";

// Dots are legal in ids, so `..` alone would satisfy a charset check and escape via path.join —
// the dot-segment rejection and the containment assert below are both load-bearing.
const SAFE_ID = /^[a-zA-Z0-9_.-]+$/;

function isSafeId(id: string): boolean {
  return SAFE_ID.test(id) && id !== "." && id !== "..";
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ runId: string; pageId: string }> }) {
  const { runId, pageId } = await params;
  if (!isSafeId(runId) || !isSafeId(pageId)) {
    return new Response("Invalid run or page id", { status: 400 });
  }

  const filePath = rawHtmlPath(runId, pageId);
  // Final containment check: whatever the id rules allow, the resolved file must live under the
  // runs directory. Survives any future change to how the path is built.
  const resolved = path.resolve(filePath);
  const root = path.resolve(runsDir());
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return new Response("Invalid run or page id", { status: 400 });
  }
  try {
    await stat(filePath);
  } catch {
    return new Response("No raw HTML stored for this page", { status: 404 });
  }

  const html = await readFile(filePath, "utf8");
  const download = req.nextUrl.searchParams.get("download") === "1";
  // Decision: crawled markup is untrusted third-party content and this tool has no auth — serve
  // as text/plain (never text/html) so opening it can never execute a script in our own origin.
  const headers = new Headers({ "content-type": "text/plain; charset=utf-8" });
  if (download) headers.set("content-disposition", `attachment; filename="${pageId}.html"`);
  return new Response(html, { headers });
}
