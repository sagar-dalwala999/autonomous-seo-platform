import { NextRequest, NextResponse } from "next/server";
import { DEMO_USERNAME, DEMO_PASSWORD, SESSION_COOKIE, SESSION_VALUE } from "@/lib/session";

// fixture: constant-time-ish compare only — this is a demo account, not real auth
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  let username = "";
  let password = "";

  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => ({}) as Record<string, string>);
    username = body.username ?? "";
    password = body.password ?? "";
  } else {
    const form = await request.formData();
    username = form.get("username")?.toString() ?? "";
    password = form.get("password")?.toString() ?? "";
  }

  const ok = safeEqual(username, DEMO_USERNAME) && safeEqual(password, DEMO_PASSWORD);
  if (!ok) {
    return NextResponse.redirect(new URL("/login?error=1", request.url), { status: 303 });
  }

  const response = NextResponse.redirect(new URL("/members", request.url), { status: 303 });
  response.cookies.set(SESSION_COOKIE, SESSION_VALUE, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
  });
  return response;
}

// bait target: "/api/session?action=logout" is a plain <a> a crawler could follow via GET.
// If it does, the logout is real — that's what proves (or disproves) the crawler's safety guard.
export async function GET(request: NextRequest) {
  const action = request.nextUrl.searchParams.get("action");
  if (action === "logout") {
    const response = NextResponse.redirect(new URL("/", request.url));
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }
  return NextResponse.json({ error: "unsupported action" }, { status: 400 });
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
