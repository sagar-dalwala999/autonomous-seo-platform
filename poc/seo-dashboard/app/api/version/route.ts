import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

/** GET /version — build/version info (spec §7, public). No CI build SHA is available in a local
 *  POC dev server; reports what is actually knowable instead of a fabricated SHA. */
export async function GET() {
  let version = "unknown";
  try {
    const pkg = JSON.parse(await readFile(path.resolve(process.cwd(), "package.json"), "utf8"));
    version = pkg.version ?? "unknown";
  } catch {
    // leave "unknown"
  }
  return NextResponse.json({ dashboardVersion: version, nodeVersion: process.version, buildSha: null, ruleRegistryVersion: null, configVersion: null });
}
