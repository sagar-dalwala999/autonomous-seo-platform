import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CrawlQueue } from "../../../src/queue/queue";
import { CrawlCancelledError } from "../../../src/crawler/crawl";
import type { JobRecord, JobRunner } from "../../../src/queue/types";

let outRoot: string;

beforeEach(async () => {
  outRoot = await mkdtemp(path.join(tmpdir(), "queue-test-"));
});

afterEach(async () => {
  await rm(outRoot, { recursive: true, force: true });
});

/** Waits for the queue's own lifecycle event rather than guessing how many microtask/fs-I/O
 * ticks a run() takes — persist() does real disk writes, so a fixed number of Promise.resolve()
 * flushes is not enough and would make this test flaky. */
function waitForEvent(queue: CrawlQueue, event: string): Promise<JobRecord> {
  return new Promise((resolve) => queue.once(event, resolve));
}

/** Deferred-promise runner: caller controls exactly when each job "finishes", so tests can
 * observe the queue mid-run without racing real timers. */
function deferredRunner(): { runner: JobRunner; resolve: (id: string, pagesCrawled?: number) => void; reject: (id: string, err: Error) => void; started: string[] } {
  const pending = new Map<string, { resolve: (v: { pagesCrawled: number; failedPages: number; reportPath: string | null }) => void; reject: (e: Error) => void }>();
  const started: string[] = [];
  const runner: JobRunner = ({ job, signal }) =>
    new Promise((resolve, reject) => {
      started.push(job.id);
      pending.set(job.id, { resolve, reject });
      signal.addEventListener("abort", () => {
        reject(new CrawlCancelledError());
      });
    });
  return {
    runner,
    started,
    resolve: (id, pagesCrawled = 1) => pending.get(id)?.resolve({ pagesCrawled, failedPages: 0, reportPath: null }),
    reject: (id, err) => pending.get(id)?.reject(err),
  };
}

describe("CrawlQueue", () => {
  it("job states + FIFO position: a second job waits while the first runs at concurrency 1", async () => {
    const { runner, resolve, started } = deferredRunner();
    const queue = new CrawlQueue({ concurrency: 1, runner, outRoot });
    await queue.whenReady();

    const job1Started = waitForEvent(queue, "started");
    const job1 = await queue.submit({ url: "https://a.test/" });
    const job2 = await queue.submit({ url: "https://b.test/" });
    await job1Started;

    expect(started).toEqual([job1.id]);
    expect(queue.get(job1.id)?.state).toBe("running");
    expect(queue.get(job2.id)?.state).toBe("queued");
    const listed = queue.list();
    expect(listed.find((j) => j.id === job2.id)?.queuePosition).toBe(1);
    expect(queue.stats()).toMatchObject({ concurrency: 1, queued: 1, running: 1, total: 2 });

    const job2Started = waitForEvent(queue, "started");
    const job1Finished = waitForEvent(queue, "finished");
    resolve(job1.id, 5);
    await job1Finished;
    await job2Started;

    expect(started).toEqual([job1.id, job2.id]);
    expect(queue.get(job1.id)?.state).toBe("done");
    expect(queue.get(job1.id)?.pagesCrawled).toBe(5);
    expect(queue.get(job2.id)?.state).toBe("running");

    const job2Finished = waitForEvent(queue, "finished");
    resolve(job2.id, 3);
    await job2Finished;
    expect(queue.get(job2.id)?.state).toBe("done");
  });

  it("priority: a higher-priority job submitted second still runs before a lower-priority one still queued", async () => {
    const { runner, resolve, started } = deferredRunner();
    const queue = new CrawlQueue({ concurrency: 1, runner, outRoot });
    await queue.whenReady();

    const lowStarted = waitForEvent(queue, "started");
    const low = await queue.submit({ url: "https://low.test/", priority: 0 });
    await lowStarted;
    expect(started).toEqual([low.id]); // already running by the time the next two are queued

    const mid = await queue.submit({ url: "https://mid.test/", priority: 1 });
    const high = await queue.submit({ url: "https://high.test/", priority: 5 });
    expect(queue.list().find((j) => j.id === high.id)?.queuePosition).toBe(1);
    expect(queue.list().find((j) => j.id === mid.id)?.queuePosition).toBe(2);

    const highStarted = waitForEvent(queue, "started");
    resolve(low.id);
    await highStarted;
    expect(started).toEqual([low.id, high.id]);
  });

  it("cancel(queued) removes it from the waiting line without ever running it", async () => {
    const { runner, started } = deferredRunner();
    const queue = new CrawlQueue({ concurrency: 1, runner, outRoot });
    await queue.whenReady();

    const job1Started = waitForEvent(queue, "started");
    await queue.submit({ url: "https://a.test/" }); // occupies the only worker
    await job1Started;
    const job2 = await queue.submit({ url: "https://b.test/" });

    const cancelled = queue.cancel(job2.id);
    expect(cancelled?.state).toBe("cancelled");
    expect(queue.get(job2.id)?.state).toBe("cancelled");
    expect(queue.list().find((j) => j.id === job2.id)?.queuePosition).toBeNull();
    expect(started).not.toContain(job2.id); // never ran — this is the fix, not the reference defect
  });

  it("cancel(running) aborts the signal the runner was given, and the job lands 'cancelled' not 'failed'", async () => {
    const { runner } = deferredRunner();
    const queue = new CrawlQueue({ concurrency: 1, runner, outRoot });
    await queue.whenReady();

    const started = waitForEvent(queue, "started");
    const job = await queue.submit({ url: "https://a.test/" });
    await started;
    expect(queue.get(job.id)?.state).toBe("running");

    const finished = waitForEvent(queue, "finished");
    queue.cancel(job.id); // the deferred runner rejects with CrawlCancelledError on abort
    await finished;

    expect(queue.get(job.id)?.state).toBe("cancelled");
    expect(queue.get(job.id)?.error).toBeNull(); // cancelled is not an error
  });

  it("a job that genuinely fails (not cancelled) lands 'failed' with the error recorded", async () => {
    const { runner, reject } = deferredRunner();
    const queue = new CrawlQueue({ concurrency: 1, runner, outRoot });
    await queue.whenReady();

    const started = waitForEvent(queue, "started");
    const job = await queue.submit({ url: "https://a.test/" });
    await started;

    const finished = waitForEvent(queue, "finished");
    reject(job.id, new Error("DNS lookup failed"));
    await finished;

    expect(queue.get(job.id)?.state).toBe("failed");
    expect(queue.get(job.id)?.error).toBe("DNS lookup failed");
  });

  it("retention deletes BOTH the in-memory record and the on-disk job directory once past keepJobs", async () => {
    const { runner, resolve } = deferredRunner();
    const queue = new CrawlQueue({ concurrency: 1, runner, outRoot, keepJobs: 2 });
    await queue.whenReady();

    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const started = waitForEvent(queue, "started");
      const job = await queue.submit({ url: `https://n${i}.test/` });
      ids.push(job.id);
      await started;
      const finished = waitForEvent(queue, "finished");
      resolve(job.id);
      await finished;
    }

    expect(queue.list()).toHaveLength(2); // in-memory bounded

    // best-effort async rm() — give it a turn to land before checking disk
    await new Promise((r) => setTimeout(r, 100));
    const onDisk = await readdir(outRoot);
    for (const goneId of ids.slice(0, 2)) {
      expect(onDisk).not.toContain(goneId); // deleted from disk, not just forgotten in memory
    }
    for (const keptId of ids.slice(2)) {
      expect(onDisk).toContain(keptId);
    }
  });

  it("rehydrates from disk after a restart: finished jobs reappear, a job stuck 'running' becomes 'failed'", async () => {
    const { runner, resolve } = deferredRunner();
    const first = new CrawlQueue({ concurrency: 1, runner, outRoot });
    await first.whenReady();
    const started = waitForEvent(first, "started");
    const done = await first.submit({ url: "https://done.test/" });
    await started;
    const finished = waitForEvent(first, "finished");
    resolve(done.id, 7);
    await finished;
    expect(first.get(done.id)?.state).toBe("done");

    // Simulate a job that was mid-flight when the process died — no queue instance ever marks
    // it finished, it just sits on disk as "running".
    const orphanDir = path.join(outRoot, "j9999");
    await mkdir(orphanDir, { recursive: true });
    await writeFile(
      path.join(orphanDir, "job.json"),
      JSON.stringify({
        id: "j9999", url: "https://stuck.test/", options: {}, priority: 0, state: "running",
        submittedAt: Date.now(), startedAt: Date.now(), finishedAt: null, runId: "j9999",
        error: null, pagesCrawled: null, failedPages: null, reportPath: null,
      }),
      "utf8",
    );

    // Fresh process, same out/jobs/ directory.
    const second = new CrawlQueue({ concurrency: 1, runner: deferredRunner().runner, outRoot });
    await second.whenReady();

    expect(second.get(done.id)?.state).toBe("done"); // completed work survives the restart
    expect(second.get(done.id)?.pagesCrawled).toBe(7);
    expect(second.get("j9999")?.state).toBe("failed"); // a stuck "running" cannot be resumed
    expect(second.get("j9999")?.error).toMatch(/restarted/);

    // The id sequence continues past the highest id seen on disk (j9999), not restarting at 1 —
    // otherwise the next submit would collide with an existing job directory.
    const next = await second.submit({ url: "https://new.test/" });
    expect(Number(next.id.slice(1))).toBeGreaterThan(9999);
  });

  it("cancelling an already-finished job is a no-op that returns its real state", async () => {
    const { runner, resolve } = deferredRunner();
    const queue = new CrawlQueue({ concurrency: 1, runner, outRoot });
    await queue.whenReady();
    const started = waitForEvent(queue, "started");
    const job = await queue.submit({ url: "https://a.test/" });
    await started;
    const finished = waitForEvent(queue, "finished");
    resolve(job.id);
    await finished;

    const result = queue.cancel(job.id);
    expect(result?.state).toBe("done");
  });
});
