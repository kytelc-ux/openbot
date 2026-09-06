import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
  cloudMaterialSchema,
  cloudMemorySchema,
  cloudRunSchema,
  readCloudMaterial,
} from "@/lib/cloud-team/form";
import {
  cancelCloudRunMutationOptions,
  createCloudMaterialMutationOptions,
  createCloudRunMutationOptions,
} from "@/lib/cloud-team/mutations";
import {
  cloudRunQueryOptions,
  cloudTeamKeys,
  cloudTeamQueryOptions,
  formatCloudCost,
} from "@/lib/cloud-team/queries";

afterEach(() => {
  globalThis.fetch = originalFetch;
});
const originalFetch = globalThis.fetch;

describe("Cloud Team material import", () => {
  test("previews a selected text file and preserves its source name", async () => {
    const network = spyOn(globalThis, "fetch");
    expect(
      await readCloudMaterial(new File(["# Evidence"], "grokbot-notes.md")),
    ).toEqual({
      title: "grokbot-notes.md",
      source: "grokbot-notes.md",
      content: "# Evidence",
    });
    expect(network).not.toHaveBeenCalled();
    network.mockRestore();
  });

  test("rejects binary, hidden, unsupported, empty, and oversized content", async () => {
    for (const file of [
      new File(["secret"], ".credentials.json"),
      new File(["pdf"], "notes.pdf"),
      new File(["a\0b"], "notes.txt"),
      new File(["   "], "notes.md"),
      new File(["a".repeat(30_001)], "notes.md"),
      new File(["a".repeat(120_001)], "notes.txt"),
    ]) {
      await expect(readCloudMaterial(file)).rejects.toThrow();
    }
  });

  test("requires provenance and bounds manual text and lessons", () => {
    expect(
      cloudMaterialSchema.safeParse({
        title: "Note",
        source: "",
        content: "Fact",
      }).success,
    ).toBe(false);
    expect(
      cloudMemorySchema.safeParse({ content: "a".repeat(4_001) }).success,
    ).toBe(false);
    expect(
      cloudRunSchema.safeParse({ objective: "  ", materialIds: [] }).success,
    ).toBe(false);
    expect(
      cloudRunSchema.parse({ objective: "  Draft a plan  ", materialIds: [] })
        .objective,
    ).toBe("Draft a plan");
  });
});

describe("Cloud Team transport", () => {
  test("reads through the shared authenticated client", async () => {
    const response = {
      configured: false,
      materials: [],
      runs: [],
      memories: [],
    };
    const network = spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(response),
    );
    const options = cloudTeamQueryOptions();
    const cache = new QueryClient();
    expect(await cache.fetchQuery(options)).toEqual(response);
    expect(network.mock.calls[0]?.[0]).toBe("/api/cloud-team");
    expect(network.mock.calls[0]?.[1]?.credentials).toBe("include");
    expect(options.queryKey[0]).toBe(cloudTeamKeys.all[0]);
    cache.clear();
    network.mockRestore();
  });

  test("sends structured bodies without double serialization", async () => {
    const network = spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ material: { id: "m1" } }),
    );
    const cache = new QueryClient();
    const input = {
      title: "Notes",
      source: "grokbot.md",
      content: "Reviewed source",
    };
    const mutation = cache
      .getMutationCache()
      .build(cache, createCloudMaterialMutationOptions(cache));
    expect(await mutation.execute(input)).toEqual({ id: "m1" });
    expect(JSON.parse(String(network.mock.calls[0]?.[1]?.body))).toEqual(input);
    cache.clear();
    network.mockRestore();
  });

  test("surfaces budget refusal instead of queuing a success-shaped result", async () => {
    const network = spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ error: "Daily budget exhausted." }, { status: 429 }),
    );
    const cache = new QueryClient();
    const mutation = cache
      .getMutationCache()
      .build(cache, createCloudRunMutationOptions(cache));
    await expect(
      mutation.execute({ objective: "Draft", materialIds: [] }),
    ).rejects.toThrow("Daily budget exhausted.");
    expect(network).toHaveBeenCalledTimes(1);
    cache.clear();
    network.mockRestore();
  });

  test("cancellation encodes the task identifier", async () => {
    const network = spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ run: { status: "cancelled" } }),
    );
    const cache = new QueryClient();
    const mutation = cache
      .getMutationCache()
      .build(cache, cancelCloudRunMutationOptions(cache));
    await mutation.execute("id/with spaces");
    expect(network.mock.calls[0]?.[0]).toBe(
      "/api/cloud-team/runs/id%2Fwith%20spaces/cancel",
    );
    expect(network.mock.calls[0]?.[1]?.method).toBe("POST");
    cache.clear();
    network.mockRestore();
  });

  test("keeps small but billable spend visible", () => {
    expect(formatCloudCost(0.0008)).toBe("$0.0008");
    expect(formatCloudCost(0.000001)).toBe("$0.000001");
    expect(formatCloudCost(0)).toBe("$0.00");
  });

  test("reads an older task independently of the recent task list", async () => {
    const network = spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ run: { id: "older-task", status: "completed" } }),
    );
    const cache = new QueryClient();
    expect(await cache.fetchQuery(cloudRunQueryOptions("older-task"))).toEqual({
      id: "older-task",
      status: "completed",
    });
    expect(network.mock.calls[0]?.[0]).toBe("/api/cloud-team/runs/older-task");
    expect(cloudTeamKeys.run("older-task")[0]).toBe(cloudTeamKeys.all[0]);
    cache.clear();
    network.mockRestore();
  });
});
