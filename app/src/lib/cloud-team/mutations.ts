import { mutationOptions, type QueryClient } from "@tanstack/react-query";
import { client } from "@/lib/client";
import {
  type CloudMaterial,
  type CloudMemory,
  type CloudRun,
  cloudTeamKeys,
} from "./queries";

export type CloudMaterialInput = {
  title: string;
  content: string;
  source: string;
};
export type CloudRunInput = { objective: string; materialIds: string[] };
export type CloudMemoryInput = { content: string; sourceRunId?: string };

const FALLBACK = "Cloud Team operation failed";
const invalidate = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({ queryKey: cloudTeamKeys.all });

export function createCloudMaterialMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (input: CloudMaterialInput): Promise<CloudMaterial> =>
      client("/api/cloud-team/materials", "material", {
        method: "POST",
        body: input,
        fallback: FALLBACK,
      }),
    onSuccess: () => invalidate(queryClient),
  });
}

export function deleteCloudMaterialMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: async (id: string) => {
      await client(`/api/cloud-team/materials/${encodeURIComponent(id)}`, {
        method: "DELETE",
        fallback: FALLBACK,
      });
    },
    onSuccess: () => invalidate(queryClient),
  });
}

export function createCloudMemoryMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (input: CloudMemoryInput): Promise<CloudMemory> =>
      client("/api/cloud-team/memories", "memory", {
        method: "POST",
        body: input,
        fallback: FALLBACK,
      }),
    onSuccess: () => invalidate(queryClient),
  });
}

export function deleteCloudMemoryMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: async (id: string) => {
      await client(`/api/cloud-team/memories/${encodeURIComponent(id)}`, {
        method: "DELETE",
        fallback: FALLBACK,
      });
    },
    onSuccess: () => invalidate(queryClient),
  });
}

export function createCloudRunMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (input: CloudRunInput): Promise<CloudRun> =>
      client("/api/cloud-team/runs", "run", {
        method: "POST",
        body: input,
        fallback: FALLBACK,
      }),
    onSuccess: () => invalidate(queryClient),
  });
}

export function cancelCloudRunMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (id: string): Promise<CloudRun> =>
      client(`/api/cloud-team/runs/${encodeURIComponent(id)}/cancel`, "run", {
        method: "POST",
        fallback: FALLBACK,
      }),
    onSuccess: () => invalidate(queryClient),
  });
}
