// globalThis, not module-scope: the page and the API route compile into separate bundles
// under Next.js's per-route chunking, so a plain module-level `let` gives each its own copy.
// globalThis is the one thing genuinely shared across bundles within a single Node process.
const store = globalThis as unknown as { __pocDangerHits?: number };

export function recordDangerHit() {
  store.__pocDangerHits = (store.__pocDangerHits ?? 0) + 1;
  return store.__pocDangerHits;
}

export function getDangerHits() {
  return store.__pocDangerHits ?? 0;
}
