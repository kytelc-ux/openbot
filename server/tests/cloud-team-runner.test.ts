import { describe, expect, test } from "bun:test";
import type { CloudTeamConfig } from "../src/cloud-team/config";
import type { ModelProvider } from "../src/cloud-team/provider";
import { createCloudTeamRunner } from "../src/cloud-team/runner";
import {
  type ClaimedRun,
  CloudTeamRefusedError,
  type CloudTeamStore,
} from "../src/cloud-team/store";
import type { CloudTeamRunStatus } from "../src/cloud-team/types";

const descriptor = {
  provider: "openai" as const,
  model: "operator-model",
  inputUsdPerMillion: 1,
  outputUsdPerMillion: 2,
  maxOutputTokens: 100,
};
const config: CloudTeamConfig = {
  planner: descriptor,
  worker: descriptor,
  reviewer: descriptor,
  dailyBudgetUsd: 10,
  runBudgetUsd: 5,
  maxSteps: 5,
};
const claimed = {
  run: {
    id: "run-1",
    ownerUserId: "user-1",
    objective: "Draft a supported summary",
    status: "running",
    result: null,
    error: null,
    spentMicros: 0,
    reservedMicros: 0,
    inputTokens: 0,
    outputTokens: 0,
    claimedBy: "worker",
    leaseUntil: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  materials: [
    {
      id: "material-1",
      ownerUserId: "user-1",
      title: "Brief",
      content: "Revenue was 10.",
      source: "brief.txt",
      createdAt: new Date(),
    },
  ],
  memories: [],
} satisfies ClaimedRun;

function harness(outputs: string[]) {
  let status: CloudTeamRunStatus = "running";
  const calls: string[] = [];
  const stopped: Array<{ status: string; error?: string; result?: string }> =
    [];
  const store = {
    claim: async () => claimed,
    status: async () => status,
    reserveStep: async ({ role }: { role: string }) => {
      calls.push(`reserve:${role}`);
      return { id: `step-${calls.length}`, ordinal: calls.length - 1 };
    },
    finishStep: async ({ stepId }: { stepId: string }) => {
      calls.push(`finish:${stepId}`);
    },
    retainStepReservation: async () => {
      status = "needs_review";
      calls.push("retain");
    },
    stopRun: async (
      _id: string,
      next: CloudTeamRunStatus,
      error?: string,
      result?: string,
    ) => {
      status = next;
      stopped.push({ status: next, error, result });
    },
  } as unknown as CloudTeamStore;
  let index = 0;
  const provider: ModelProvider = {
    complete: async () => ({
      text: outputs[index++] ?? "",
      inputTokens: 10,
      outputTokens: 5,
    }),
  };
  return {
    store,
    provider,
    calls,
    stopped,
    setStatus: (next: CloudTeamRunStatus) => (status = next),
  };
}

describe("Cloud Team orchestration", () => {
  test("plans at most three tasks, runs workers sequentially, and accepts review", async () => {
    const h = harness([
      '{"tasks":["research","draft"]}',
      "first [material:material-1]",
      "second [material:material-1]",
      '{"approved":true,"result":"final [material:material-1]","feedback":""}',
    ]);
    await createCloudTeamRunner({ ...h, config, owner: "test" }).sweep();
    expect(h.calls.filter((call) => call.startsWith("reserve"))).toEqual([
      "reserve:planner",
      "reserve:worker",
      "reserve:worker",
      "reserve:reviewer",
    ]);
    expect(h.stopped.at(-1)).toEqual({
      status: "completed",
      error: undefined,
      result: "final [material:material-1]",
    });
  });

  test("reviewer rejection requires human review and never repairs automatically", async () => {
    const h = harness([
      '{"tasks":["draft"]}',
      "unsupported",
      '{"approved":false,"result":"","feedback":"Missing citation."}',
    ]);
    await createCloudTeamRunner({ ...h, config, owner: "test" }).sweep();
    expect(h.stopped.at(-1)?.status).toBe("needs_review");
    expect(h.calls.filter((call) => call === "reserve:worker")).toHaveLength(1);
  });

  test("invalid planning JSON fails without retrying the paid request", async () => {
    const h = harness(["not json"]);
    await createCloudTeamRunner({ ...h, config, owner: "test" }).sweep();
    expect(h.calls.filter((call) => call === "reserve:planner")).toHaveLength(
      1,
    );
    expect(h.stopped.at(-1)?.status).toBe("failed");
  });

  test("a provider failure retains reservation and is never retried", async () => {
    const h = harness([]);
    let attempts = 0;
    h.provider.complete = async () => {
      attempts += 1;
      throw new Error("network");
    };
    await createCloudTeamRunner({ ...h, config, owner: "test" }).sweep();
    expect(attempts).toBe(1);
    expect(h.calls).toContain("retain");
    expect(h.stopped).toEqual([]);
  });

  test("a cancellation before the next call prevents another reservation", async () => {
    const h = harness(['{"tasks":["draft"]}']);
    const originalFinish = h.store.finishStep;
    h.store.finishStep = async (input) => {
      await originalFinish(input);
      h.setStatus("cancelled");
    };
    await createCloudTeamRunner({ ...h, config, owner: "test" }).sweep();
    expect(h.calls.filter((call) => call.startsWith("reserve"))).toEqual([
      "reserve:planner",
    ]);
    expect(h.stopped).toEqual([]);
  });

  test("a budget refusal stops before a provider call", async () => {
    const h = harness([]);
    h.store.reserveStep = async () => {
      h.setStatus("budget_exceeded");
      throw new CloudTeamRefusedError("budget");
    };
    let called = false;
    h.provider.complete = async () => {
      called = true;
      throw new Error("must not happen");
    };
    await createCloudTeamRunner({ ...h, config, owner: "test" }).sweep();
    expect(called).toBe(false);
  });

  test("shutdown during a provider call settles it, starts no next call, and requires review", async () => {
    const stop = new AbortController();
    const h = harness(['{"tasks":["must not run"]}']);
    let providerCalls = 0;
    h.provider.complete = async () => {
      providerCalls += 1;
      stop.abort();
      return {
        text: '{"tasks":["must not run"]}',
        inputTokens: 10,
        outputTokens: 5,
      };
    };

    await createCloudTeamRunner({
      ...h,
      config,
      owner: "test",
      signal: stop.signal,
    }).sweep();

    expect(providerCalls).toBe(1);
    expect(h.calls.filter((call) => call.startsWith("reserve"))).toEqual([
      "reserve:planner",
    ]);
    expect(h.stopped.at(-1)?.status).toBe("needs_review");
    expect(h.stopped.at(-1)?.error).toContain("worker is shutting down");
  });

  test("shutdown while reserving prevents the reserved provider call", async () => {
    const stop = new AbortController();
    const h = harness([]);
    h.store.reserveStep = async ({ role }) => {
      h.calls.push(`reserve:${role}`);
      stop.abort();
      return { id: "held-reservation", ordinal: 0 };
    };
    let providerCalls = 0;
    h.provider.complete = async () => {
      providerCalls += 1;
      throw new Error("must not run");
    };

    await createCloudTeamRunner({
      ...h,
      config,
      owner: "test",
      signal: stop.signal,
    }).sweep();

    expect(providerCalls).toBe(0);
    expect(h.calls).toEqual(["reserve:planner"]);
    expect(h.stopped.at(-1)?.status).toBe("needs_review");
  });
});
