import { NextRequest, NextResponse } from "next/server";
import { verifyState, exchangeCodeAndStore } from "@/lib/gsc/oauth";

/**
 * Google's redirect target after the OAuth round-trip. Deliberately public —
 * it arrives as a top-level browser navigation from accounts.google.com, and
 * whether the session cookie is attached to a cross-site navigation depends on
 * SameSite policy. The signed `state` parameter carries the identity instead.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code") ?? undefined;
  const state = url.searchParams.get("state") ?? undefined;
  const error = url.searchParams.get("error");

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim() || "http://localhost:3100").replace(/\/+$/, "");

  if (error) {
    return NextResponse.redirect(`${appUrl}/gsc?gsc=denied`);
  }

  const userId = await verifyState(state);
  if (!userId || !code) {
    return NextResponse.redirect(`${appUrl}/gsc?gsc=invalid_state`);
  }

  try {
    await exchangeCodeAndStore(userId, code);
    return NextResponse.redirect(`${appUrl}/gsc?gsc=connected`);
  } catch (err) {
    console.error("[gsc] callback failed:", err);
    return NextResponse.redirect(`${appUrl}/gsc?gsc=failed`);
  }
}
