import { NextResponse } from "next/server";
import { gscSession } from "@/lib/gsc/route-helpers";
import { disconnect } from "@/lib/gsc/oauth";

/** DELETE — revokes the Google grant and drops the local connection. */
export async function DELETE() {
  const __auth = await gscSession();
  if ("response" in __auth) return __auth.response;

  await disconnect(__auth.userId);
  return NextResponse.json({ disconnected: true });
}
