import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

// Next 16 renamed middleware -> proxy (see AGENTS.md). This is the only place that can
// actually return a bare 401 before a page renders — a page component can't set its own status.
export function proxy(request: NextRequest) {
  if (!request.cookies.has(SESSION_COOKIE)) {
    return new Response("Login required", {
      status: 401,
      headers: { "content-type": "text/plain" },
    });
  }
}

export const config = {
  matcher: ["/members", "/members/:path*"],
};
