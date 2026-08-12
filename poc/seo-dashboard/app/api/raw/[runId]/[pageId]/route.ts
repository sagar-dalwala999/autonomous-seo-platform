import { readFile, stat } from "node:fs/promises";
import { NextRequest } from "next/server";
import { rawHtmlPath } from "@/lib/data";

const SAFE_ID = /^[a-zA-Z0-9_.-]+$/;

export async function GET(req: NextRequest, { params }: { params: Promise<{ runId: string; pageId: string }> }) {
  const { runId, pageId } = await params;
  if (!SAFE_ID.test(runId) || !SAFE_ID.test(pageId)) {
    return new Response("Invalid run or page id", { status: 400 });
  }

  const filePath = rawHtmlPath(runId, pageId);
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
