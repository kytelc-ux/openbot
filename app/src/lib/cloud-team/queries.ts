import { queryOptions } from "@tanstack/react-query";
import { client } from "@/lib/client";

export type CloudMaterial = {
  id: string;
  title: string;
  content: string;
  source: string;
  createdAt: string;
};

export type CloudMemory = {
  id: string;
  content: string;
  sourceRunId: string | null;
  createdAt: string;
};

export type CloudStep = {
  id: string;
  role: "planner" | "worker" | "reviewer";
  model: string;
  status: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  output: string | null;
};

export type CloudRun = {
  id: string;
  objective: string;
  status:
    | "queued"
    | "running"
    | "completed"
    | "needs_review"
    | "failed"
    | "budget_exceeded"
    | "cancelled";
  result: string | null;
  error: string | null;
  spentUsd: number;
  reservedUsd: number;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
  steps: CloudStep[];
};

export type CloudTeamOverview = {
  configured: boolean;
  configurationError?: string;
  policy: {
    dailyBudgetUsd: number;
    runBudgetUsd: number;
    maxSteps: number;
  } | null;
  usage: {
    spentUsd: number;
    reservedUsd: number;
    inputTokens: number;
    outputTokens: number;
  };
  models: { planner: string; worker: string; reviewer: string } | null;
  materials: CloudMaterial[];
  memories: CloudMemory[];
  runs: CloudRun[];
};

export const cloudTeamKeys = {
  all: ["cloud-team"] as const,
  overview: () => ["cloud-team", "overview"] as const,
  run: (id: string) => ["cloud-team", "run", id] as const,
};

export function cloudTeamQueryOptions() {
  return queryOptions({
    queryKey: cloudTeamKeys.overview(),
    queryFn: async ({ signal }): Promise<CloudTeamOverview> =>
      (
        await client("/api/cloud-team", {
          signal,
          fallback: "Could not load Cloud Team",
        })
      ).json(),
    refetchInterval: (query) =>
      query.state.data?.runs.some(isActiveRun) ? 5_000 : 30_000,
  });
}

export function cloudRunQueryOptions(id: string) {
  return queryOptions({
    queryKey: cloudTeamKeys.run(id),
    queryFn: ({ signal }): Promise<CloudRun> =>
      client(`/api/cloud-team/runs/${encodeURIComponent(id)}`, "run", {
        signal,
        fallback: "Could not load this Cloud Team task",
      }),
    refetchInterval: (query) =>
      query.state.data && isActiveRun(query.state.data) ? 2_000 : false,
  });
}

export function isActiveRun(run: CloudRun): boolean {
  return run.status === "queued" || run.status === "running";
}

export function formatCloudCost(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(value);
}
