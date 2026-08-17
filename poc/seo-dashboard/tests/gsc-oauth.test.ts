import { describe, it, expect, afterEach } from "vitest";
import { buildAuthUrl, verifyState } from "../lib/gsc/oauth";

/**
 * The OAuth `state` is a signed token that the callback must verify. A past
 * bug hashed the raw JSON Buffer at sign time but the base64url string at
 * verify time, so sign and verify never agreed and every callback failed as
 * "invalid state". These tests pin the round-trip so it can't regress.
 */
const ENV_BACKUP = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ENV_BACKUP)) delete process.env[key];
  }
  Object.assign(process.env, ENV_BACKUP);
});

function withGscEnv(): void {
  process.env.GSC_STATE_SECRET = "test-state-secret";
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
}

describe("OAuth state signing", () => {
  it("signs a state that verifyState accepts, recovering the user id", async () => {
    withGscEnv();
    const url = await buildAuthUrl("user-123");
    const state = new URL(url).searchParams.get("state");
    expect(state).toBeTruthy();
    expect(await verifyState(state ?? undefined)).toBe("user-123");
  });

  it("rejects a tampered state", async () => {
    withGscEnv();
    const url = await buildAuthUrl("user-123");
    const state = new URL(url).searchParams.get("state") ?? "";
    // Flip the last character of the signature.
    const tampered = state.slice(0, -1) + (state.endsWith("a") ? "b" : "a");
    expect(await verifyState(tampered)).toBeNull();
  });

  it("rejects a state signed with a different secret", async () => {
    withGscEnv();
    const url = await buildAuthUrl("user-123");
    const state = new URL(url).searchParams.get("state") ?? "";
    process.env.GSC_STATE_SECRET = "a-different-secret";
    expect(await verifyState(state)).toBeNull();
  });

  it("rejects a missing or empty state", async () => {
    expect(await verifyState(undefined)).toBeNull();
    expect(await verifyState("")).toBeNull();
  });
});
