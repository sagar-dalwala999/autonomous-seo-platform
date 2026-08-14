import { NextResponse } from "next/server";
import { getExportMeta } from "@/lib/data-export";
import { notFound } from "@/lib/api-shared";
import { requireApiSession } from "@/lib/auth-guard";

/** GET /exports/:id — export status + download URL (spec §7). Download served by the sibling
 *  route .../download (same-origin file stream — this local-disk POC has no signed-URL storage). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const { id } = await params;
  const meta = await getExportMeta(id);
  if (!meta) return notFound(`No export found for id "${id}".`);
  return NextResponse.json({ ...meta, url: meta.status === "completed" ? `/api/exports/${id}/download` : null });
}
