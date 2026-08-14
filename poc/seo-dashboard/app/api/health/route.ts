import { NextResponse } from "next/server";

/** GET /health — liveness (spec §7, public). */
export async function GET() {
  return NextResponse.json({ ok: true });
}
