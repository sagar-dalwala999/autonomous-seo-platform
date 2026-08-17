import { NextResponse } from "next/server";
import { gscSession, gscErrorResponse } from "@/lib/gsc/route-helpers";
import { buildAuthUrl } from "@/lib/gsc/oauth";

/** GET — returns the Google consent URL as JSON (the SPA navigates there). */
export async function GET() {
  const __auth = await gscSession();
  if ("response" in __auth) return __auth.response;

  try {
    const authUrl = await buildAuthUrl(__auth.userId);
    return NextResponse.json({ authUrl });
  } catch (err) {
    return gscErrorResponse(err);
  }
}
