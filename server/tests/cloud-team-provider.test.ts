import { describe, expect, test } from "bun:test";
import { createModelProvider, reserveMicros } from "../src/cloud-team/provider";

describe("Cloud Team provider adapters", () => {
  test("uses OpenAI Responses and records returned usage", async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    const provider = createModelProvider(
      { OPENAI_API_KEY: "secret" },
      async (url, init) => {
        request = { url: String(url), init };
        return Response.json({
          output_text: "answer",
          usage: { input_tokens: 12, output_tokens: 4 },
        });
      },
    );
    const result = await provider.complete({
      descriptor: {
        provider: "openai",
        model: "operator-model",
        inputUsdPerMillion: 1,
        outputUsdPerMillion: 2,
        maxOutputTokens: 100,
      },
      prompt: "hello",
    });
    expect(request?.url).toBe("https://api.openai.com/v1/responses");
    expect(JSON.parse(String(request?.init?.body))).toMatchObject({
      model: "operator-model",
      input: "hello",
      max_output_tokens: 100,
    });
    expect(result).toEqual({
      text: "answer",
      inputTokens: 12,
      outputTokens: 4,
    });
  });

  test("uses Anthropic messages and records returned usage", async () => {
    let url = "";
    const provider = createModelProvider(
      { ANTHROPIC_API_KEY: "secret" },
      async (input) => {
        url = String(input);
        return Response.json({
          content: [{ type: "text", text: "answer" }],
          usage: { input_tokens: 8, output_tokens: 3 },
        });
      },
    );
    const result = await provider.complete({
      descriptor: {
        provider: "anthropic",
        model: "operator-model",
        inputUsdPerMillion: 1,
        outputUsdPerMillion: 2,
        maxOutputTokens: 100,
      },
      prompt: "hello",
    });
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(result).toEqual({ text: "answer", inputTokens: 8, outputTokens: 3 });
  });

  test("reserves pessimistically from UTF-8 bytes plus output cap", () => {
    expect(
      reserveMicros(
        {
          provider: "openai",
          model: "x",
          inputUsdPerMillion: 1,
          outputUsdPerMillion: 2,
          maxOutputTokens: 100,
        },
        "hello",
      ),
    ).toBe(2_253);
  });

  test.each(["https://gateway.example", "https://gateway.example/v1/"])(
    "normalizes provider base %s and disables redirects and response storage",
    async (baseUrl) => {
      let requestUrl = "";
      let options: RequestInit | undefined;
      const provider = createModelProvider(
        { OPENAI_API_KEY: "test-only" },
        async (url, init) => {
          requestUrl = String(url);
          options = init;
          return Response.json({
            status: "completed",
            output: [{ content: [{ type: "output_text", text: "answer" }] }],
            usage: { input_tokens: 2, output_tokens: 1 },
          });
        },
      );
      expect(
        (
          await provider.complete({
            descriptor: {
              provider: "openai",
              model: "test",
              baseUrl,
              inputUsdPerMillion: 1,
              outputUsdPerMillion: 1,
              maxOutputTokens: 10,
            },
            prompt: "hello",
          })
        ).text,
      ).toBe("answer");
      expect(requestUrl).toBe("https://gateway.example/v1/responses");
      expect(options?.redirect).toBe("error");
      expect(JSON.parse(String(options?.body)).store).toBe(false);
    },
  );

  test.each([
    { output_text: "answer" },
    { output_text: "answer", usage: { input_tokens: -1, output_tokens: 1 } },
    { output_text: "answer", usage: { input_tokens: 1.5, output_tokens: 1 } },
    {
      status: "incomplete",
      output_text: "partial",
      usage: { input_tokens: 1, output_tokens: 1 },
    },
    { output: {}, usage: { input_tokens: 1, output_tokens: 1 } },
  ])(
    "refuses malformed or incomplete output without retries",
    async (response) => {
      let calls = 0;
      const provider = createModelProvider(
        { OPENAI_API_KEY: "test-only" },
        async () => {
          calls++;
          return Response.json(response);
        },
      );
      await expect(
        provider.complete({
          descriptor: {
            provider: "openai",
            model: "test",
            inputUsdPerMillion: 1,
            outputUsdPerMillion: 1,
            maxOutputTokens: 10,
          },
          prompt: "hello",
        }),
      ).rejects.toThrow();
      expect(calls).toBe(1);
    },
  );

  test("counts cached Anthropic input without assuming a discount", async () => {
    const provider = createModelProvider(
      { ANTHROPIC_API_KEY: "test-only" },
      async () =>
        Response.json({
          stop_reason: "end_turn",
          content: [{ type: "text", text: "answer" }],
          usage: {
            input_tokens: 2,
            output_tokens: 1,
            cache_read_input_tokens: 10,
          },
        }),
    );
    expect(
      (
        await provider.complete({
          descriptor: {
            provider: "anthropic",
            model: "test",
            inputUsdPerMillion: 1,
            outputUsdPerMillion: 1,
            maxOutputTokens: 10,
          },
          prompt: "hello",
        })
      ).inputTokens,
    ).toBe(12);
  });

  test("does not expose provider error bodies", async () => {
    let calls = 0;
    const provider = createModelProvider(
      { OPENAI_API_KEY: "test-only" },
      async () => {
        calls++;
        return Response.json(
          { error: "sensitive upstream data" },
          { status: 429 },
        );
      },
    );
    await expect(
      provider.complete({
        descriptor: {
          provider: "openai",
          model: "test",
          inputUsdPerMillion: 1,
          outputUsdPerMillion: 1,
          maxOutputTokens: 10,
        },
        prompt: "hello",
      }),
    ).rejects.toThrow("rate limit");
    expect(calls).toBe(1);
  });
});
