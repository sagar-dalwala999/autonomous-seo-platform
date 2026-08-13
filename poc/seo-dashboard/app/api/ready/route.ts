import { stat } from "node:fs/promises";
import { NextResponse } from "next/server";
import { runsDirPath } from "@/lib/crawl-control";

/** GET /ready — readiness: can this process actually see the storage dir (spec §7, public). No
 *  DB/queue in this POC, so `db`/`queue` are reported as not-applicable rather than faked true. */
export async function GET() {
  let storageOk = false;
  try {
    await stat(runsDirPath());
    storageOk = true;
  } catch {
    storageOk = false;
  }
  return NextResponse.json({ db: "not-applicable", storage: storageOk, queue: "not-applicable", ok: storageOk });
}
