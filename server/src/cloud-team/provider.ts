import { z } from "zod";
import type { CloudTeamModelConfig } from "./config";

export type ModelResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
};
export type ModelProvider = {
  complete: (input: {
    descriptor: CloudTeamModelConfig;
    prompt: string;
  }) => Promise<ModelResult>;
};
type FetchRequest = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class CloudTeamProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudTeamProviderError";
  }
}

const endpoint = (base: string | undefined, fallback: string, path: string) =>
  `${(base ?? fallback).replace(/\/+$/, "").replace(/\/v1$/, "")}/v1/${path}`;

const tokens = z.number().int().min(0).max(10_000_000);
const openAiResponse = z.object({
  status: z.string().optional(),
  output_text: z.string().max(250_000).optional(),
  output: z
    .array(
      z.object({
        content: z
          .array(
            z.object({
              type: z.string(),
              text: z.string().max(250_000).optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
  usage: z.object({ input_tokens: tokens, output_tokens: tokens }),
});
const anthropicResponse = z.object({
  stop_reason: z.string().nullable().optional(),
  content: z.array(
    z.object({ type: z.string(), text: z.string().max(250_000).optional() }),
  ),
  usage: z.object({
    input_tokens: tokens,
    output_tokens: tokens,
    cache_read_input_tokens: tokens.optional(),
    cache_creation_input_tokens: tokens.optional(),
  }),
});

async function safeJson(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const retry =
      response.status === 429 ? " The provider rate limit was reached." : "";
    throw new CloudTeamProviderError(
      `The ${response.status} provider request failed.${retry}`.trim(),
    );
  }
  if (!body || typeof body !== "object") {
    throw new CloudTeamProviderError(
      "The provider returned an invalid response.",
    );
  }
  return body as Record<string, unknown>;
}

export function createModelProvider(
  environment: Record<string, string | undefined> = process.env,
  request: FetchRequest = fetch,
): ModelProvider {
  return {
    async complete({ descriptor, prompt }) {
      if (descriptor.provider === "openai") {
        const response = await request(
          endpoint(descriptor.baseUrl, "https://api.openai.com", "responses"),
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${environment.OPENAI_API_KEY}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: descriptor.model,
              input: prompt,
              max_output_tokens: descriptor.maxOutputTokens,
              store: false,
            }),
            redirect: "error",
            signal: AbortSignal.timeout(120_000),
          },
        );
        const parsed = openAiResponse.safeParse(await safeJson(response));
        if (!parsed.success)
          throw new CloudTeamProviderError(
            "The provider omitted valid output or token usage.",
          );
        const body = parsed.data;
        if (body.status && body.status !== "completed") {
          throw new CloudTeamProviderError(
            "The provider did not complete its response.",
          );
        }
        const text =
          body.output_text ??
          body.output
            ?.flatMap((item) => item.content ?? [])
            .filter((item) => item.type === "output_text")
            .map((item) => item.text ?? "")
            .join("") ??
          "";
        if (!text)
          throw new CloudTeamProviderError("The provider returned no text.");
        return {
          text,
          inputTokens: body.usage.input_tokens,
          outputTokens: body.usage.output_tokens,
        };
      }

      const response = await request(
        endpoint(descriptor.baseUrl, "https://api.anthropic.com", "messages"),
        {
          method: "POST",
          headers: {
            "x-api-key": environment.ANTHROPIC_API_KEY ?? "",
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: descriptor.model,
            max_tokens: descriptor.maxOutputTokens,
            messages: [{ role: "user", content: prompt }],
          }),
          redirect: "error",
          signal: AbortSignal.timeout(120_000),
        },
      );
      const parsed = anthropicResponse.safeParse(await safeJson(response));
      if (!parsed.success)
        throw new CloudTeamProviderError(
          "The provider omitted valid output or token usage.",
        );
      const body = parsed.data;
      if (body.stop_reason && body.stop_reason !== "end_turn") {
        throw new CloudTeamProviderError(
          "The provider did not complete its response.",
        );
      }
      if (body.usage.cache_creation_input_tokens) {
        throw new CloudTeamProviderError(
          "Unconfigured provider cache-write billing requires review.",
        );
      }
      const text = body.content
        .filter((part) => part.type === "text")
        .map((part) => part.text ?? "")
        .join("");
      if (!text)
        throw new CloudTeamProviderError("The provider returned no text.");
      return {
        text,
        inputTokens:
          body.usage.input_tokens + (body.usage.cache_read_input_tokens ?? 0),
        outputTokens: body.usage.output_tokens,
      };
    },
  };
}

export function pricedMicros(
  descriptor: CloudTeamModelConfig,
  inputTokens: number,
  outputTokens: number,
): number {
  const cost = Math.ceil(
    inputTokens * descriptor.inputUsdPerMillion +
      outputTokens * descriptor.outputUsdPerMillion,
  );
  if (!Number.isSafeInteger(cost) || cost < 0) {
    throw new CloudTeamProviderError(
      "Provider cost is outside the accounting range.",
    );
  }
  return cost;
}

export function reserveMicros(
  descriptor: CloudTeamModelConfig,
  prompt: string,
): number {
  // Budget one token per UTF-8 byte plus message overhead, without cache discounts.
  const inputUpperBound = new TextEncoder().encode(prompt).byteLength + 2_048;
  return pricedMicros(descriptor, inputUpperBound, descriptor.maxOutputTokens);
}
