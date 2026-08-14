import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { maybeUploadScreenshot, _resetWarnedNotConfiguredForTests, type DbModule } from "../../../src/artifacts/supabaseUpload";

// Deliberately does NOT perform the real dynamic import of packages/db — that import has a real,
// live side effect verified during this work: it pulls in @prisma/client, which auto-loads
// packages/db/.env (real Supabase credentials in this checkout) into process.env regardless of
// what this test's own env holds. Exercising the real path here would risk a real upload to a
// real Supabase Storage bucket from a test run, which is exactly what this suite must not do.
// The `loader` injection point exists for precisely this reason — see supabaseUpload.ts's CAUTION.

function fakeUnconfigured(reason = "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set"): () => Promise<DbModule> {
  return async () => ({
    getServiceClient: () => ({ configured: false, client: null, reason }),
    uploadArtifact: async () => {
      throw new Error("uploadArtifact must never be called when not configured");
    },
  });
}

function fakeConfigured(uploadArtifact: DbModule["uploadArtifact"]): () => Promise<DbModule> {
  return async () => ({
    getServiceClient: () => ({ configured: true, client: {} }),
    uploadArtifact,
  });
}

describe("maybeUploadScreenshot", () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    _resetWarnedNotConfiguredForTests();
    dir = await mkdtemp(path.join(tmpdir(), "artifact-upload-test-"));
    filePath = path.join(dir, "fake-screenshot.webp");
    await writeFile(filePath, Buffer.from("not a real webp, just needs bytes"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("degrades to a named 'not configured' state — never throws, never silently no-ops", async () => {
    const result = await maybeUploadScreenshot("test-run", "abc123", "full", filePath, fakeUnconfigured());
    expect(result.configured).toBe(false);
    expect(result.reason).toBe("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set");
  });

  it("logs a visible 'not configured' note exactly once per warned state, not per call", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await maybeUploadScreenshot("test-run", "abc123", "full", filePath, fakeUnconfigured());
    await maybeUploadScreenshot("test-run", "def456", "thumb", filePath, fakeUnconfigured());
    const notConfiguredLogs = logSpy.mock.calls.filter((c) => String(c[0]).includes("not configured"));
    expect(notConfiguredLogs).toHaveLength(1);
    logSpy.mockRestore();
  });

  it("never throws even when the local file does not exist (not-configured path)", async () => {
    const missing = path.join(dir, "does-not-exist.webp");
    const result = await maybeUploadScreenshot("test-run", "abc123", "full", missing, fakeUnconfigured());
    expect(result.configured).toBe(false);
  });

  it("never throws when the local file does not exist even on the configured path — readFile failure is caught", async () => {
    const missing = path.join(dir, "does-not-exist.webp");
    const upload = vi.fn();
    const result = await maybeUploadScreenshot("test-run", "abc123", "full", missing, fakeConfigured(upload));
    expect(result.configured).toBe(false);
    expect(result.error).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();
  });

  it("uploads to the screenshots bucket at <runId>/<pageId>.<kind>.webp when configured", async () => {
    const upload = vi.fn().mockResolvedValue({ bytes: 1234 });
    const result = await maybeUploadScreenshot("run-42", "abc123", "full", filePath, fakeConfigured(upload));
    expect(result.configured).toBe(true);
    expect(result.bucket).toBe("screenshots");
    expect(result.path).toBe("run-42/abc123.full.webp");
    expect(result.bytes).toBe(1234);
    expect(upload).toHaveBeenCalledWith("screenshots", "run-42/abc123.full.webp", expect.any(Buffer), "image/webp");
  });

  it("never throws when the underlying upload call itself rejects", async () => {
    const upload = vi.fn().mockRejectedValue(new Error("network exploded"));
    const result = await maybeUploadScreenshot("run-42", "abc123", "full", filePath, fakeConfigured(upload));
    expect(result.configured).toBe(false);
    expect(result.error).toContain("network exploded");
  });
});
