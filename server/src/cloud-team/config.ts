import { z } from "zod";

const finiteMoney = z.number().finite().positive().max(1_000_000);
const model = z.object({
  provider: z.enum(["openai", "anthropic"]),
  model: z.string().trim().min(1).max(200),
  baseUrl: z
    .string()
    .url()
    .max(2_000)
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    }, "must be an HTTPS provider base URL without credentials, query or fragment")
    .optional(),
  inputUsdPerMillion: finiteMoney,
  outputUsdPerMillion: finiteMoney,
  maxOutputTokens: z.number().int().min(1).max(16_000),
});
const schema = z
  .object({
    planner: model,
    worker: model,
    reviewer: model,
    dailyBudgetUsd: finiteMoney,
    runBudgetUsd: finiteMoney,
    maxSteps: z.number().int().min(3).max(6),
  })
  .superRefine((value, context) => {
    if (value.runBudgetUsd > value.dailyBudgetUsd) {
      context.addIssue({
        code: "custom",
        path: ["runBudgetUsd"],
        message: "must not exceed dailyBudgetUsd",
      });
    }
  });

export type CloudTeamModelConfig = z.infer<typeof model>;
export type CloudTeamConfig = z.infer<typeof schema>;
export type CloudTeamConfiguration =
  | { configured: true; config: CloudTeamConfig }
  | { configured: false; error?: string };

export function loadCloudTeamConfig(
  environment: Record<string, string | undefined> = process.env,
): CloudTeamConfiguration {
  const raw = environment.CLOUD_TEAM_CONFIG?.trim();
  if (!raw) return { configured: false };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {
      configured: false,
      error: "CLOUD_TEAM_CONFIG must be valid JSON.",
    };
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return {
      configured: false,
      error: `CLOUD_TEAM_CONFIG is invalid: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "value"} ${issue.message}`)
        .join("; ")}`,
    };
  }
  const providers = new Set([
    parsed.data.planner.provider,
    parsed.data.worker.provider,
    parsed.data.reviewer.provider,
  ]);
  if (providers.has("openai") && !environment.OPENAI_API_KEY?.trim()) {
    return {
      configured: false,
      error: "OPENAI_API_KEY is required by the configured Cloud Team models.",
    };
  }
  if (providers.has("anthropic") && !environment.ANTHROPIC_API_KEY?.trim()) {
    return {
      configured: false,
      error:
        "ANTHROPIC_API_KEY is required by the configured Cloud Team models.",
    };
  }
  return { configured: true, config: parsed.data };
}
