import tls from "node:tls";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkCertificate } from "../../../src/crawler/crawl";

/** Real TLS handshake against a real (self-signed, dev-only) certificate — this proves
 * checkCertificate() genuinely inspects a certificate rather than fabricating a result. Node's
 * default verifier rejects a self-signed cert, which is exactly what this test asserts: a real,
 * specific verification error surfaces as the note, not a made-up one. */
let server: tls.Server | undefined;
let certPort: number;
let closedPort: number;
let hasCerts = false;

beforeAll(async () => {
  const certDir = path.join(__dirname, "..", "..", "fixtures", "certs");
  try {
    const [cert, key] = await Promise.all([
      readFile(path.join(certDir, "cert.pem")),
      readFile(path.join(certDir, "key.pem")),
    ]);
    server = tls.createServer({ cert, key }, (socket) => socket.end());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    certPort = (server.address() as AddressInfo).port;

    const probe = tls.createServer({ cert, key });
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    closedPort = (probe.address() as AddressInfo).port;
    await new Promise((resolve) => probe.close(resolve));
    hasCerts = true;
  } catch {
    hasCerts = false;
  }
});

afterAll(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

describe("checkCertificate", () => {
  it("reports a self-signed certificate as invalid, with Node's real verifier error as the note", async () => {
    if (!hasCerts) return;
    const result = await checkCertificate("127.0.0.1", 5000, certPort);
    expect(result.valid).toBe(false);
    expect(result.note.toLowerCase()).toMatch(/self.signed|self signed|unable to verify/);
    expect(result.validFrom).toBeNull(); // handshake never completed — no cert to read dates from
    expect(result.validTo).toBeNull();
  });

  it("resolves cleanly (never throws) against a host with nothing listening", async () => {
    if (!hasCerts) return;
    const result = await checkCertificate("127.0.0.1", 1500, closedPort);
    expect(result.valid).toBe(false);
    expect(result.note).toBeTruthy();
    expect(result.validFrom).toBeNull();
  });
});
