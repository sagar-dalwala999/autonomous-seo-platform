import "server-only";

export interface ArtifactStorageStatus {
  configured: boolean;
  reason?: string;
}

/**
 * Whether cloud artifact storage (Supabase Storage, screenshots bucket) is configured for THIS
 * process. Mirrors the "configured" check packages/db's getServiceClient() does for the crawler's
 * best-effort upload (src/artifacts/supabaseUpload.ts) — same env var names, so one pair of
 * values controls both sides — but implemented locally rather than imported: the dashboard has
 * zero dependency on packages/db by design (importing its dist/index.js drags in @prisma/client,
 * which auto-loads packages/db/.env into process.env as an import side effect — a real hazard
 * documented in supabaseUpload.ts that this file deliberately does not reintroduce here).
 *
 * MVP acceptance criterion #11: with SUPABASE_SERVICE_ROLE_KEY empty, the UI must say "artifact
 * storage not configured" wherever artifacts/screenshots/page-replay appear, not render blank or
 * crash. Local disk stays the primary evidence store regardless (screenshots/raw HTML are always
 * read from storage/runs/**) — this only reports whether the durable cloud copy is available.
 */
export function getArtifactStorageStatus(): ArtifactStorageStatus {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const missing = [!url && "SUPABASE_URL", !key && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean) as string[];
  if (missing.length > 0) {
    return { configured: false, reason: `${missing.join(" and ")} not set` };
  }
  return { configured: true };
}
