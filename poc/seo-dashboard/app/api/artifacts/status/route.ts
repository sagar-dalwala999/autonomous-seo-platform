import { NextResponse } from "next/server";
import { getArtifactStorageStatus } from "@/lib/artifact-status";

/** GET /api/artifacts/status — {configured, reason?} for whether cloud artifact storage
 *  (Supabase Storage) is set up in this process. Never exposes the key itself, just its presence. */
export async function GET() {
  return NextResponse.json(getArtifactStorageStatus());
}
