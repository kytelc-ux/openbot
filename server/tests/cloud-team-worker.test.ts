import { describe, expect, test } from "bun:test";
import {
  type CloudTeamWorkerEvent,
  runCloudTeamWorker,
} from "../src/cloud-team/worker";

describe("Cloud Team dedicated worker", () => {
  test("runs once by default", async () => {
    let sweeps = 0;
    const events: CloudTeamWorkerEvent[] = [];
    await runCloudTeamWorker({
      sweep: async () => {
        sweeps += 1;
        return true;
      },
      loop: false,
      signal: new AbortController().signal,
      report: (event) => events.push(event),
    });
    expect(sweeps).toBe(1);
    expect(events).toEqual([{ type: "cloud-team-sweep", ran: true }]);
  });

  test("logs a loop failure and continues without overlapping sweeps", async () => {
    const stop = new AbortController();
    const events: CloudTeamWorkerEvent[] = [];
    let sweeps = 0;
    await runCloudTeamWorker({
      sweep: async () => {
        sweeps += 1;
        if (sweeps === 1) throw new Error("database unavailable");
        stop.abort();
        return false;
      },
      loop: true,
      pollMs: 100,
      signal: stop.signal,
      report: (event) => events.push(event),
    });
    expect(sweeps).toBe(2);
    expect(events).toEqual([
      {
        type: "cloud-team-sweep-failed",
        error: "database unavailable",
      },
      { type: "cloud-team-sweep", ran: false },
    ]);
  });

  test("SIGTERM-style abort waits for an active sweep and does not claim again", async () => {
    const stop = new AbortController();
    let release: (() => void) | undefined;
    let sweeps = 0;
    const active = runCloudTeamWorker({
      sweep: async () => {
        sweeps += 1;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return true;
      },
      loop: true,
      pollMs: 100,
      signal: stop.signal,
      report: () => undefined,
    });
    await Promise.resolve();
    stop.abort();
    release?.();
    await active;
    expect(sweeps).toBe(1);
  });
});
