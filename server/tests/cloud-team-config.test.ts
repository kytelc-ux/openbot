import { describe, expect, test } from "bun:test";
import { loadCloudTeamConfig } from "../src/cloud-team/config";

const value = {
  planner: {
    provider: "anthropic",
    model: "operator-planner",
    inputUsdPerMillion: 5,
    outputUsdPerMillion: 15,
    maxOutputTokens: 2_000,
  },
  worker: {
    provider: "openai",
    model: "operator-worker",
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 4,
    maxOutputTokens: 1_000,
  },
  reviewer: {
    provider: "openai",
    model: "operator-reviewer",
    inputUsdPerMillion: 2,
    outputUsdPerMillion: 8,
    maxOutputTokens: 1_000,
  },
  dailyBudgetUsd: 20,
  runBudgetUsd: 5,
  maxSteps: 5,
};

describe("Cloud Team configuration", () => {
  test("is off when absent and never invents model ids or prices", () => {
    expect(loadCloudTeamConfig({})).toEqual({ configured: false });
  });

  test("requires keys for every configured provider", () => {
    expect(
      loadCloudTeamConfig({ CLOUD_TEAM_CONFIG: JSON.stringify(value) }),
    ).toEqual({
      configured: false,
      error: "OPENAI_API_KEY is required by the configured Cloud Team models.",
    });
  });

  test("accepts exact operator-provided model ids and rates", () => {
    const result = loadCloudTeamConfig({
      CLOUD_TEAM_CONFIG: JSON.stringify(value),
      OPENAI_API_KEY: "openai",
      ANTHROPIC_API_KEY: "anthropic",
    });
    expect(result.configured).toBe(true);
    if (result.configured)
      expect(result.config.worker.model).toBe("operator-worker");
  });

  test.each([
    [{ ...value, runBudgetUsd: Number.POSITIVE_INFINITY }],
    [{ ...value, dailyBudgetUsd: -1 }],
    [{ ...value, maxSteps: 1000 }],
    [{ ...value, runBudgetUsd: 21 }],
  ])("rejects unsafe budget configuration", (candidate) => {
    expect(
      loadCloudTeamConfig({
        CLOUD_TEAM_CONFIG: JSON.stringify(candidate),
        OPENAI_API_KEY: "openai",
        ANTHROPIC_API_KEY: "anthropic",
      }).configured,
    ).toBe(false);
  });

  test.each([
    "http://gateway.example",
    "https://user:password@gateway.example",
    "https://gateway.example?key=secret",
    "https://gateway.example#fragment",
  ])("rejects unsafe provider base URL %s", (baseUrl) => {
    expect(
      loadCloudTeamConfig({
        CLOUD_TEAM_CONFIG: JSON.stringify({
          ...value,
          worker: { ...value.worker, baseUrl },
        }),
        OPENAI_API_KEY: "test-only",
        ANTHROPIC_API_KEY: "test-only",
      }).configured,
    ).toBe(false);
  });
});
