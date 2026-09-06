import { expect, test } from "bun:test";
import type { CloudTeamStore } from "../src/cloud-team/store";
import { cloudTeamMemoryTools } from "../src/cloud-team/tools";

test("memory tool reads only its actor and bounds returned context", async () => {
  let owner = "";
  const store = {
    listMemories: async (actor: string) => {
      owner = actor;
      return Array.from({ length: 100 }, (_, index) => ({
        id: `memory-${index}`,
        content: "a".repeat(4_000),
        sourceRunId: null,
        createdAt: new Date().toISOString(),
      }));
    },
  } satisfies Pick<CloudTeamStore, "listMemories">;
  const tools = cloudTeamMemoryTools(store, "actor-a");
  expect(tools).toHaveLength(1);
  const output = await tools[0]!.execute({});
  expect(owner).toBe("actor-a");
  expect(String(output).length).toBeLessThan(41_000);
  expect(String(output)).not.toContain("[memory:memory-20]");
});
