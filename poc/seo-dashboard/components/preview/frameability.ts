/** Whether the LIVE page can be embedded, decided from the response headers we already stored —
 * so we never render an iframe that will silently show a blank box. A framing refusal produces no
 * catchable error in the embedding page, which is exactly why this is a pre-flight check. */
export function frameability(headers: Record<string, string> | undefined | null): {
  canFrameLive: boolean;
  frameBlockedBy: string | null;
} {
  const h = headers ?? {};
  const xfo = h["x-frame-options"];
  if (xfo && xfo.trim()) {
    return { canFrameLive: false, frameBlockedBy: `X-Frame-Options: ${xfo.trim()}` };
  }

  const csp = h["content-security-policy"];
  const ancestors = csp ? /frame-ancestors([^;]*)/i.exec(csp) : null;
  if (ancestors) {
    const value = ancestors[1]!.trim();
    // A bare * permits any embedder; anything else is an allow-list we are almost certainly not on.
    if (value !== "*") {
      return { canFrameLive: false, frameBlockedBy: `CSP frame-ancestors ${value || "'none'"}` };
    }
  }

  return { canFrameLive: true, frameBlockedBy: null };
}
