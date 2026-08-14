import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventLog } from "../../../src/events/eventLog";
import type { CrawlActivityEvent } from "../../../src/events/types";

let outDir: string;

beforeEach(async () => {
  outDir = await mkdtemp(path.join(tmpdir(), "eventlog-test-"));
});

afterEach(async () => {
  await rm(outDir, { recursive: true, force: true });
});

describe("EventLog", () => {
  it("writes durable NDJSON — one JSON object per line, in append order", async () => {
    const log = new EventLog(outDir, "run-a");
    await log.init();
    log.emit({ kind: "crawl-started", url: "https://x.test/", statusCode: null, message: "start" });
    log.emit({ kind: "request", url: "https://x.test/a", statusCode: 200, message: "200 /a" });
    log.emit({ kind: "request", url: "https://x.test/b", statusCode: 404, message: "404 /b" });
    await log.flush();

    const raw = await readFile(path.join(outDir, "runs", "run-a", "events.ndjson"), "utf8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(3);
    const parsed = lines.map((l) => JSON.parse(l) as CrawlActivityEvent);
    expect(parsed.map((e) => e.kind)).toEqual(["crawl-started", "request", "request"]);
    expect(parsed.map((e) => e.seq)).toEqual([1, 2, 3]); // provable order even if timestamps collide
    expect(parsed[2]!.statusCode).toBe(404);
    expect(parsed.every((e) => e.runId === "run-a")).toBe(true);
  });

  it("tails live — a subscriber is called synchronously as each event is emitted, before flush", async () => {
    const log = new EventLog(outDir, "run-b");
    await log.init();
    const seen: CrawlActivityEvent[] = [];
    const unsubscribe = log.subscribe((e) => seen.push(e));

    log.emit({ kind: "crawl-started", url: null, statusCode: null, message: "start" });
    // The listener already has it — live tail does not wait for the disk write to land.
    expect(seen).toHaveLength(1);
    expect(seen[0]!.kind).toBe("crawl-started");

    log.emit({ kind: "request", url: "https://x.test/", statusCode: 200, message: "200 /" });
    expect(seen).toHaveLength(2);

    unsubscribe();
    log.emit({ kind: "crawl-finished", url: null, statusCode: null, message: "done" });
    expect(seen).toHaveLength(2); // unsubscribed — no further deliveries

    await log.flush();
  });

  it("replays from disk after the fact — a fresh EventLog handle never touched by the writer", async () => {
    const log = new EventLog(outDir, "run-c");
    await log.init();
    for (let i = 0; i < 50; i++) {
      log.emit({ kind: "request", url: `https://x.test/${i}`, statusCode: 200, message: `page ${i}` });
    }
    await log.flush();

    // Simulates a fresh process reading the log back — no shared object, no shared memory.
    const replayed: CrawlActivityEvent[] = [];
    for await (const event of EventLog.replay(outDir, "run-c")) replayed.push(event);

    expect(replayed).toHaveLength(50);
    expect(replayed[0]!.url).toBe("https://x.test/0");
    expect(replayed[49]!.url).toBe("https://x.test/49");
    expect(replayed.map((e) => e.seq)).toEqual(replayed.map((_, i) => i + 1));
  });

  it("replay of a run that never wrote any events yields nothing, not an error", async () => {
    const replayed: CrawlActivityEvent[] = [];
    for await (const event of EventLog.replay(outDir, "never-ran")) replayed.push(event);
    expect(replayed).toEqual([]);
  });
});
