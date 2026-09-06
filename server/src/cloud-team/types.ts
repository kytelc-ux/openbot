export type CloudTeamRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "needs_review"
  | "failed"
  | "budget_exceeded"
  | "cancelled";
export type CloudTeamRole = "planner" | "worker" | "reviewer";

export type Material = {
  id: string;
  title: string;
  content: string;
  source: string;
  createdAt: string;
};
export type Memory = {
  id: string;
  content: string;
  sourceRunId: string | null;
  createdAt: string;
};
export type Step = {
  id: string;
  role: CloudTeamRole;
  model: string;
  status: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  output: string | null;
};
export type Run = {
  id: string;
  objective: string;
  status: CloudTeamRunStatus;
  result: string | null;
  error: string | null;
  spentUsd: number;
  reservedUsd: number;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
  steps: Step[];
};

export type CloudTeamSnapshot = {
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
  materials: Material[];
  memories: Memory[];
  runs: Run[];
};
