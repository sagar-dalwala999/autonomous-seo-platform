import { readExportFile } from "@/lib/data-export";
import { notFound } from "@/lib/api-shared";
import { requireApiSession } from "@/lib/auth-guard";

/** GET /exports/:id/download — streams the exported file. Not in the spec §7 table verbatim (the
 *  spec models this as a signed-URL redirect from GET /exports/:id); this POC has no object
 *  storage to sign a URL against, so the file is served directly from the same origin instead. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const __auth = await requireApiSession();
  if ("response" in __auth) return __auth.response;

  const { id } = await params;
  const file = await readExportFile(id);
  if (!file) return notFound(`No export file found for id "${id}".`);
  return new Response(file.content, {
    headers: { "Content-Type": file.contentType, "Content-Disposition": `attachment; filename="${file.fileName}"` },
  });
}
