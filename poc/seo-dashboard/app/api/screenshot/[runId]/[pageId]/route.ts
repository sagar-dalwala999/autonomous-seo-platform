import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { runsDir } from "@/lib/data";
import { requireApiSession } from "@/lib/auth-guard";

// Same guard as app/api/raw and app/api/replay: dots are legal in ids, so ".." alone clears a
// charset check and escapes via path.join. Dot-segment rejection AND the containment assert are
// both load-bearing. Duplicated rather than imported to keep lib/data.ts untouched.
const SAFE_ID = /^[a-zA-Z0-9_.-]+$/;

function isSafeId(id: string): boolean {
  return SAFE_ID.test(id) && id !== "." && id !== "..";
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ runId: string; pageId: string }> }) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const { runId, pageId } = await params;
  if (!isSafeId(runId) || !isSafeId(pageId)) {
    return Response.json({ error: "Invalid run or page id" }, { status: 400 });
  }

  const size = req.nextUrl.searchParams.get("size") === "full" ? "full" : "thumb";
  const filePath = path.join(runsDir(), runId, "screenshots", `${pageId}.${size}.webp`);

  const resolved = path.resolve(filePath);
  const root = path.resolve(runsDir());
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return Response.json({ error: "Invalid run or page id" }, { status: 400 });
  }

  try {
    await stat(resolved);
  } catch {
    return Response.json({ error: "No screenshot for this page", size }, { status: 404 });
  }

  const bytes = await readFile(resolved);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/webp",
      // Immutable: a run's screenshots never change once written.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
