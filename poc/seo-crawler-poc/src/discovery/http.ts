/** Shared fetch-with-timeout for discovery. Callers catch — this never throws on timeout vs any other rejection differently. */
export const DISCOVERY_TIMEOUT_MS = 10_000;

export async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Resolves a possibly-relative URL against origin; null when unparseable (evidence, not a throw). */
export function resolveAbsolute(raw: string, origin: string): string | null {
  try {
    return new URL(raw, origin).toString();
  } catch {
    return null;
  }
}
