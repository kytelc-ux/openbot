import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { CloudTeamConfig } from "../src/cloud-team/config";
import type { ModelProvider } from "../src/cloud-team/provider";
import { createCloudTeamRunner } from "../src/cloud-team/runner";
import {
  CloudTeamNotFoundError,
  createCloudTeamStore,
} from "../src/cloud-team/store";
import { createDatabase } from "../src/db/client";
import { cloudTeamRuns, cloudTeamSteps, users } from "../src/db/schema";
import { TEST_POOL } from "./support/database";

const database = createDatabase(
  process.env.DATABASE_URL ?? "******localhost:5432/openbot",
  TEST_POOL,
);
const store = createCloudTeamStore(database);
const suffix = randomUUID().slice(0, 8);
const ownerA = `cloud-team-a-${suffix}`;
const ownerB = `cloud-team-b-${suffix}`;
const descriptor = {
  provider: "openai" as const,
  model: "operator-test",
  inputUsdPerMillion: 1,
  outputUsdPerMillion: 1,
  maxOutputTokens: 10,
};
const policy: CloudTeamConfig = {
  planner: descriptor,
  worker: descriptor,
  reviewer: descriptor,
  dailyBudgetUsd: 1,
  runBudgetUsd: 1,
  maxSteps: 5,
};

beforeAll(async () => {
  await database.insert(users).values([
    { id: ownerA, email: `${ownerA}@test.invalid` },
    { id: ownerB, email: `${ownerB}@test.invalid` },
  ]);
});

afterAll(async () => {
  await database.delete(users).where(inArray(users.id, [ownerA, ownerB]));
  await database.$client.end({ timeout: 5 });
});

describe("Cloud Team store ownership and budgets", () => {
  test("another owner cannot read or delete a material or run", async () => {
    const material = await store.createMaterial(ownerA, {
      title: "Private",
      content: "Owner A only",
      source: "private.txt",
    });
    const run = await store.createRun(ownerA, {
      objective: "Use the private material",
      materialIds: [material.id],
    });

    await expect(
      store.deleteMaterial(ownerB, material.id),
    ).rejects.toBeInstanceOf(CloudTeamNotFoundError);
    await expect(store.getRun(ownerB, run.id)).rejects.toBeInstanceOf(
      CloudTeamNotFoundError,
    );
    await database.delete(cloudTeamRuns).where(eq(cloudTeamRuns.id, run.id));
    await store.deleteMaterial(ownerA, material.id);
  });

  test("serializes one owner's reservations across separate runs", async () => {
    const first = await store.createRun(ownerB, {
      objective: "First",
      materialIds: [],
    });
    const second = await store.createRun(ownerB, {
      objective: "Second",
      materialIds: [],
    });
    await store.claim("worker-a", 60_000);
    await store.claim("worker-b", 60_000);

    const results = await Promise.allSettled([
      store.reserveStep({
        runId: first.id,
        owner: "worker-a",
        role: "planner",
        descriptor,
        reserveMicros: 600_000,
        policy,
      }),
      store.reserveStep({
        runId: second.id,
        owner: "worker-b",
        role: "planner",
        descriptor,
        reserveMicros: 600_000,
        policy,
      }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);

    await database
      .delete(cloudTeamRuns)
      .where(inArray(cloudTeamRuns.id, [first.id, second.id]));
  });

  test("settles one reserved step exactly once", async () => {
    const run = await store.createRun(ownerA, {
      objective: "Settle once",
      materialIds: [],
    });
    await store.claim("settler", 60_000);
    const step = await store.reserveStep({
      runId: run.id,
      owner: "settler",
      role: "planner",
      descriptor,
      reserveMicros: 500_000,
      policy,
    });
    const settlement = {
      runId: run.id,
      stepId: step.id,
      inputTokens: 100,
      outputTokens: 50,
      costMicros: 200_000,
      output: "done",
    };
    await Promise.all([
      store.finishStep(settlement),
      store.finishStep(settlement),
    ]);

    const settled = await store.getRun(ownerA, run.id);
    expect(settled.spentUsd).toBe(0.2);
    expect(settled.reservedUsd).toBe(0);
    expect(settled.inputTokens).toBe(100);
    expect(settled.steps[0]?.costUsd).toBe(0.2);
    await database.delete(cloudTeamRuns).where(eq(cloudTeamRuns.id, run.id));
  });

  test("a reviewer settling after cancellation cannot resurrect the run", async () => {
    const run = await store.createRun(ownerA, {
      objective: "Cancel during review",
      materialIds: [],
    });
    await store.claim("reviewer", 60_000);
    const step = await store.reserveStep({
      runId: run.id,
      owner: "reviewer",
      role: "reviewer",
      descriptor,
      reserveMicros: 500_000,
      policy,
    });
    await store.cancelRun(ownerA, run.id);
    await store.finishStep({
      runId: run.id,
      stepId: step.id,
      inputTokens: 10,
      outputTokens: 5,
      costMicros: 100_000,
      output: '{"approved":true,"result":"late","feedback":""}',
    });
    await store.stopRun(run.id, "completed", undefined, "late");

    const cancelled = await store.getRun(ownerA, run.id);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.result).toBeNull();
    expect(cancelled.spentUsd).toBe(0.1);
    await database.delete(cloudTeamRuns).where(eq(cloudTeamRuns.id, run.id));
  });

  test("an unknown provider outcome retains accounting without overwriting cancellation", async () => {
    const run = await store.createRun(ownerA, {
      objective: "Cancel an uncertain call",
      materialIds: [],
    });
    await store.claim("uncertain-worker", 60_000);
    const step = await store.reserveStep({
      runId: run.id,
      owner: "uncertain-worker",
      role: "reviewer",
      descriptor,
      reserveMicros: 300_000,
      policy,
    });
    await store.cancelRun(ownerA, run.id);
    await store.retainStepReservation(
      run.id,
      step.id,
      "Unknown provider outcome.",
    );

    const cancelled = await store.getRun(ownerA, run.id);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.reservedUsd).toBe(0.3);
    expect(cancelled.steps[0]?.status).toBe("outcome_unknown");
    await database.delete(cloudTeamRuns).where(eq(cloudTeamRuns.id, run.id));
  });

  test("an expired lease cannot reserve another paid step", async () => {
    const run = await store.createRun(ownerA, {
      objective: "Expired",
      materialIds: [],
    });
    await store.claim("expired-worker", -1);
    await expect(
      store.reserveStep({
        runId: run.id,
        owner: "expired-worker",
        role: "planner",
        descriptor,
        reserveMicros: 100_000,
        policy,
      }),
    ).rejects.toThrow("lease expired");
    const steps = await database
      .select({ id: cloudTeamSteps.id })
      .from(cloudTeamSteps)
      .where(eq(cloudTeamSteps.runId, run.id));
    expect(steps).toHaveLength(0);
    await database.delete(cloudTeamRuns).where(eq(cloudTeamRuns.id, run.id));
  });

  test("a budget refusal commits budget_exceeded before raising", async () => {
    const run = await store.createRun(ownerA, {
      objective: "Too expensive",
      materialIds: [],
    });
    await store.claim("budget-worker", 60_000);
    await expect(
      store.reserveStep({
        runId: run.id,
        owner: "budget-worker",
        role: "planner",
        descriptor,
        reserveMicros: 200_000,
        policy: { ...policy, dailyBudgetUsd: 0.1, runBudgetUsd: 0.1 },
      }),
    ).rejects.toThrow("budget");
    expect((await store.getRun(ownerA, run.id)).status).toBe("budget_exceeded");
    await database.delete(cloudTeamRuns).where(eq(cloudTeamRuns.id, run.id));
  });

  test("today's usage follows step settlement, not yesterday's queue time", async () => {
    const run = await store.createRun(ownerA, {
      objective: "Queued yesterday",
      materialIds: [],
    });
    await database
      .update(cloudTeamRuns)
      .set({ createdAt: new Date(Date.now() - 26 * 60 * 60 * 1_000) })
      .where(eq(cloudTeamRuns.id, run.id));
    await store.claim("rollover-worker", 60_000);
    const step = await store.reserveStep({
      runId: run.id,
      owner: "rollover-worker",
      role: "planner",
      descriptor,
      reserveMicros: 500_000,
      policy,
    });
    await store.finishStep({
      runId: run.id,
      stepId: step.id,
      inputTokens: 123,
      outputTokens: 45,
      costMicros: 400_000,
      output: "settled today",
    });

    const { usage } = await store.snapshot(ownerA);
    expect(usage.spentUsd).toBe(0.4);
    expect(usage.inputTokens).toBe(123);
    expect(usage.outputTokens).toBe(45);
    await database.delete(cloudTeamRuns).where(eq(cloudTeamRuns.id, run.id));
  });

  test("an unresolved reservation from yesterday still counts today", async () => {
    const old = await store.createRun(ownerA, {
      objective: "Unknown yesterday",
      materialIds: [],
    });
    await database
      .update(cloudTeamRuns)
      .set({ createdAt: new Date(Date.now() - 26 * 60 * 60 * 1_000) })
      .where(eq(cloudTeamRuns.id, old.id));
    await store.claim("old-worker", 60_000);
    const oldStep = await store.reserveStep({
      runId: old.id,
      owner: "old-worker",
      role: "planner",
      descriptor,
      reserveMicros: 800_000,
      policy,
    });
    await store.retainStepReservation(
      old.id,
      oldStep.id,
      "Unknown provider outcome.",
    );
    await database
      .update(cloudTeamSteps)
      .set({ createdAt: new Date(Date.now() - 26 * 60 * 60 * 1_000) })
      .where(eq(cloudTeamSteps.id, oldStep.id));

    const next = await store.createRun(ownerA, {
      objective: "Today",
      materialIds: [],
    });
    await store.claim("new-worker", 60_000);
    await expect(
      store.reserveStep({
        runId: next.id,
        owner: "new-worker",
        role: "planner",
        descriptor,
        reserveMicros: 300_000,
        policy,
      }),
    ).rejects.toThrow("budget");
    expect((await store.getRun(ownerA, next.id)).status).toBe(
      "budget_exceeded",
    );
    await database
      .delete(cloudTeamRuns)
      .where(inArray(cloudTeamRuns.id, [old.id, next.id]));
  });

  test("cannot delete material selected by queued or running work", async () => {
    const material = await store.createMaterial(ownerA, {
      title: "In use",
      content: "Keep until the run stops.",
      source: "in-use.txt",
    });
    const run = await store.createRun(ownerA, {
      objective: "Use it",
      materialIds: [material.id],
    });
    await expect(store.deleteMaterial(ownerA, material.id)).rejects.toThrow(
      "queued or running",
    );
    await store.cancelRun(ownerA, run.id);
    await store.deleteMaterial(ownerA, material.id);
    await database.delete(cloudTeamRuns).where(eq(cloudTeamRuns.id, run.id));
  });

  test("runs the three-stage happy path with exact usage and owner-scoped memory", async () => {
    const ownMemory = await store.createMemory(ownerA, {
      content: "Owner A approved context.",
    });
    const otherMemory = await store.createMemory(ownerB, {
      content: "Owner B private context.",
    });
    const material = await store.createMaterial(ownerA, {
      title: "Evidence",
      content: "The supported figure is 10.",
      source: "evidence.txt",
    });
    const queued = await store.createRun(ownerA, {
      objective: "Produce a cited result.",
      materialIds: [material.id],
    });
    const prompts: string[] = [];
    const responses = [
      '{"tasks":["Draft the supported answer."]}',
      `The figure is 10 [material:${material.id}].`,
      `{"approved":true,"result":"Approved [material:${material.id}].","feedback":""}`,
    ];
    const provider: ModelProvider = {
      complete: async ({ prompt }) => {
        prompts.push(prompt);
        return {
          text: responses[prompts.length - 1] as string,
          inputTokens: 100,
          outputTokens: 50,
        };
      },
    };

    const ran = await createCloudTeamRunner({
      store,
      provider,
      config: policy,
      owner: "happy-worker",
    }).sweep();

    expect(ran).toBe(true);
    const completed = await store.getRun(ownerA, queued.id);
    expect(completed.status).toBe("completed");
    expect(completed.result).toBe(`Approved [material:${material.id}].`);
    expect(completed.steps.map((step) => step.role)).toEqual([
      "planner",
      "worker",
      "reviewer",
    ]);
    expect(completed.inputTokens).toBe(300);
    expect(completed.outputTokens).toBe(150);
    expect(completed.spentUsd).toBe(0.00045);
    expect(completed.reservedUsd).toBe(0);
    expect(completed.steps.map((step) => step.costUsd)).toEqual([
      0.00015, 0.00015, 0.00015,
    ]);
    expect(prompts.every((prompt) => prompt.includes(ownMemory.id))).toBe(true);
    expect(prompts.every((prompt) => !prompt.includes(otherMemory.id))).toBe(
      true,
    );
    expect(
      prompts.every((prompt) => !prompt.includes(otherMemory.content)),
    ).toBe(true);

    await database.delete(cloudTeamRuns).where(eq(cloudTeamRuns.id, queued.id));
    await store.deleteMaterial(ownerA, material.id);
    await store.deleteMemory(ownerA, ownMemory.id);
    await store.deleteMemory(ownerB, otherMemory.id);
  });
});
