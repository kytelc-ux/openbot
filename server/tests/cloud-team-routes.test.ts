import { describe, expect, test } from "bun:test";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { AppVariables } from "../src/auth/guards";
import { createCloudTeamRoutes } from "../src/cloud-team/routes";
import type { CloudTeamStore } from "../src/cloud-team/store";

const requireUser: MiddlewareHandler<{ Variables: AppVariables }> = async (
  context,
  next,
) => {
  context.set("actor", { id: "owner-1", email: "owner@test", role: "user" });
  await next();
};
const snapshot = {
  usage: { spentUsd: 0, reservedUsd: 0, inputTokens: 0, outputTokens: 0 },
  materials: [],
  memories: [],
  runs: [],
};

function appFor(store: Partial<CloudTeamStore>, configured = false) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.route(
    "/",
    createCloudTeamRoutes(
      store as CloudTeamStore,
      configured
        ? {
            configured: true,
            config: {
              planner: {
                provider: "openai",
                model: "p",
                inputUsdPerMillion: 1,
                outputUsdPerMillion: 1,
                maxOutputTokens: 10,
              },
              worker: {
                provider: "openai",
                model: "w",
                inputUsdPerMillion: 1,
                outputUsdPerMillion: 1,
                maxOutputTokens: 10,
              },
              reviewer: {
                provider: "openai",
                model: "r",
                inputUsdPerMillion: 1,
                outputUsdPerMillion: 1,
                maxOutputTokens: 10,
              },
              dailyBudgetUsd: 10,
              runBudgetUsd: 2,
              maxSteps: 5,
            },
          }
        : { configured: false },
      requireUser,
    ),
  );
  return app;
}

describe("Cloud Team routes", () => {
  test("stays usable for material management while execution is unconfigured", async () => {
    const owners: string[] = [];
    const app = appFor({
      snapshot: async () => snapshot,
      createMaterial: async (owner, input) => {
        owners.push(owner);
        return {
          id: "material-1",
          ...input,
          createdAt: new Date(0).toISOString(),
        };
      },
    });
    expect((await app.request("http://test/")).status).toBe(200);
    const response = await app.request("http://test/materials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Brief",
        content: "Facts",
        source: "brief.txt",
      }),
    });
    expect(response.status).toBe(201);
    expect(owners).toEqual(["owner-1"]);
  });

  test("refuses billable work while unconfigured", async () => {
    const response = await appFor({ snapshot: async () => snapshot }).request(
      "http://test/runs",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objective: "Draft", materialIds: [] }),
      },
    );
    expect(response.status).toBe(503);
  });

  test("validates bounded input before calling the store", async () => {
    let called = false;
    const response = await appFor(
      {
        createRun: async () => {
          called = true;
          throw new Error("not reached");
        },
      },
      true,
    ).request("http://test/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ objective: "x".repeat(8_001), materialIds: [] }),
    });
    expect(response.status).toBe(400);
    expect(called).toBe(false);
  });

  test("passes the authenticated owner to reads and mutations", async () => {
    const owners: string[] = [];
    const app = appFor({
      snapshot: async (owner) => {
        owners.push(owner);
        return snapshot;
      },
      deleteMemory: async (owner) => {
        owners.push(owner);
      },
    });
    await app.request("http://test/");
    await app.request(
      "http://test/memories/550e8400-e29b-41d4-a716-446655440000",
      { method: "DELETE" },
    );
    expect(owners).toEqual(["owner-1", "owner-1"]);
  });
});
