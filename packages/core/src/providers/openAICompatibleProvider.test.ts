// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createOpenAICompatibleProvider, LlmProviderError } from "./openAICompatibleProvider";
import type { SessionMessage } from "@shared/index";

const messages: SessionMessage[] = [
  {
    id: "m1",
    sessionId: "s1",
    role: "user",
    content: "你好",
    createdAt: "2026-07-03T10:00:00.000Z"
  }
];

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
    ...init
  });
}

function sseResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      }
    }),
    {
      headers: { "content-type": "text/event-stream" },
      status: 200
    }
  );
}

describe("OpenAI-compatible provider", () => {
  it("completes a non-streaming chat request", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        choices: [{ message: { content: "你好，我在这里。" } }]
      })
    );
    const provider = createOpenAICompatibleProvider({
      apiBaseUrl: "https://api.example.test/v1",
      apiKey: "sk-test",
      modelName: "deepseek-chat",
      fetch: fetchImpl as typeof fetch
    });

    await expect(provider.complete({ messages })).resolves.toEqual({
      content: "你好，我在这里。"
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.example.test/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test"
        }),
        body: expect.stringContaining('"stream":false')
      })
    );
  });

  it("omits Authorization for a local service without credentials", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ choices: [{ message: { content: "本机回应" } }] }));
    const provider = createOpenAICompatibleProvider({
      apiBaseUrl: "http://127.0.0.1:11434/v1",
      modelName: "qwen3:8b",
      fetch: fetchImpl as typeof fetch
    });

    await provider.complete({ messages });

    const calls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0][0]).toBe("http://127.0.0.1:11434/v1/chat/completions");
    expect(calls[0][1].headers).toEqual({ "Content-Type": "application/json" });
  });

  it("passes max_tokens when a utility call sets maxTokens", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        choices: [{ message: { content: "短摘要" } }]
      })
    );
    const provider = createOpenAICompatibleProvider({
      apiBaseUrl: "https://api.example.test/v1",
      apiKey: "sk-test",
      modelName: "deepseek-chat",
      fetch: fetchImpl
    });

    await provider.complete({ messages, maxTokens: 200 });

    const calls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    const body = JSON.parse(calls[0][1].body as string) as Record<string, unknown>;
    expect(body.max_tokens).toBe(200);
  });

  it("streams safe phase events and content chunks from SSE", async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
        "data: [DONE]\n\n"
      ])
    );
    const provider = createOpenAICompatibleProvider({
      apiBaseUrl: "https://api.example.test/v1/",
      apiKey: "sk-test",
      modelName: "deepseek-chat",
      fetch: fetchImpl
    });

    const events = [];
    for await (const event of provider.stream({ messages })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "status", status: "connecting" },
      { type: "status", status: "thinking" },
      { type: "status", status: "streaming" },
      { type: "chunk", content: "你" },
      { type: "chunk", content: "好" },
      { type: "status", status: "done" }
    ]);
  });

  it("throws a safe provider error without leaking api key or message content", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        {
          error: {
            message: "bad key sk-test for content 你好"
          }
        },
        { status: 401 }
      )
    );
    const provider = createOpenAICompatibleProvider({
      apiBaseUrl: "https://api.example.test/v1",
      apiKey: "sk-test",
      modelName: "deepseek-chat",
      fetch: fetchImpl
    });

    await expect(provider.complete({ messages })).rejects.toMatchObject({
      name: "LlmProviderError",
      status: 401
    });

    try {
      await provider.complete({ messages });
    } catch (error) {
      expect(error).toBeInstanceOf(LlmProviderError);
      expect(String(error)).toMatch(/HTTP 401/);
      expect(String(error)).not.toContain("sk-test");
      expect(String(error)).not.toContain("你好");
    }
  });

  it("passes AbortSignal to the streaming request", async () => {
    const fetchImpl = vi.fn(async () => sseResponse(["data: [DONE]\n\n"]));
    const provider = createOpenAICompatibleProvider({
      apiBaseUrl: "https://api.example.test/v1",
      apiKey: "sk-test",
      modelName: "deepseek-chat",
      fetch: fetchImpl
    });
    const controller = new AbortController();

    for await (const event of provider.stream({ messages, signal: controller.signal })) {
      if (event.type === "status" && event.status === "done") {
        break;
      }
    }

    const calls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("aborts a request when the configured timeout expires", async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      if (!init?.signal) return Promise.reject(new Error("missing timeout signal"));
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new DOMException("timed out", "AbortError"));
        }, { once: true });
      });
    });
    const provider = createOpenAICompatibleProvider({
      apiBaseUrl: "https://api.example.test/v1",
      apiKey: "sk-test",
      modelName: "deepseek-chat",
      timeoutMs: 1,
      fetch: fetchImpl as typeof fetch
    });

    await expect(provider.complete({ messages })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("keeps caller cancellation effective when a timeout is also configured", async () => {
    const request: { signal?: AbortSignal | null } = {};
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      request.signal = init?.signal ?? null;
      return jsonResponse({ choices: [{ message: { content: "已完成" } }] });
    });
    const provider = createOpenAICompatibleProvider({
      apiBaseUrl: "https://api.example.test/v1",
      apiKey: "sk-test",
      modelName: "deepseek-chat",
      timeoutMs: 10_000,
      fetch: fetchImpl as typeof fetch
    });
    const controller = new AbortController();

    await provider.complete({ messages, signal: controller.signal });
    controller.abort();

    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(request.signal?.aborted).toBe(true);
  });

  it.each(["deepseek-v4-flash", "deepseek-flash"])("enables official default high thinking for %s requests", async (modelName) => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        choices: [{ message: { content: "你好，我会慢一点想。" } }]
      })
    );
    const provider = createOpenAICompatibleProvider({
      apiBaseUrl: "https://api.deepseek.com",
      apiKey: "sk-test",
      modelName,
      fetch: fetchImpl
    });

    await provider.complete({ messages });

    const calls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    const body = JSON.parse(calls[0][1].body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: modelName,
      thinking: { type: "enabled" },
      reasoning_effort: "high"
    });
  });

  it("allows background utility validation to request non-thinking DeepSeek V4 Flash", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ choices: [{ message: { content: "已完成" } }] }));
    const provider = createOpenAICompatibleProvider({
      apiBaseUrl: "https://api.deepseek.com",
      apiKey: "sk-test",
      modelName: "deepseek-v4-flash",
      deepSeekThinking: "disabled",
      fetch: fetchImpl
    });

    await provider.complete({ messages });

    const calls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    const body = JSON.parse(calls[0][1].body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ model: "deepseek-v4-flash", thinking: { type: "disabled" } });
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  it("does not send vendor-private thinking params through an untrusted host", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ choices: [{ message: { content: "ok" } }] }));
    const provider = createOpenAICompatibleProvider({
      apiBaseUrl: "https://api.together.xyz/v1",
      apiKey: "sk-test",
      modelName: "deepseek-v4-pro",
      reasoningEffort: "high",
      fetch: fetchImpl
    });

    await provider.complete({ messages });

    const calls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    const body = JSON.parse(calls[0][1].body as string) as Record<string, unknown>;
    expect(body).not.toHaveProperty("thinking");
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  it("sends maximum reasoning effort to the DeepSeek V4 vision model", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ choices: [{ message: { content: "已看到" } }] }));
    const provider = createOpenAICompatibleProvider({
      apiBaseUrl: "https://api.deepseek.com",
      apiKey: "sk-test",
      modelName: "deepseek-v4-flash-vision-exp",
      reasoningEffort: "max",
      fetch: fetchImpl
    });

    await provider.complete({
      messages,
      imageInputs: [{ name: "photo.png", mimeType: "image/png", dataUrl: "data:image/png;base64,aGVsbG8=" }]
    });

    const calls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    const body = JSON.parse(calls[0][1].body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "deepseek-v4-flash-vision-exp",
      thinking: { type: "enabled" },
      reasoning_effort: "max"
    });
    const requestMessages = body.messages as Array<{ role: string; content: unknown }>;
    const userContent = requestMessages.find((message) => message.role === "user")?.content;
    expect(userContent).toEqual([
      { type: "text", text: "你好" },
      { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } }
    ]);
  });

  it("maps provider-specific reasoning controls without sending unsupported levels", async () => {
    const cases = [
      {
        apiBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
        modelName: "glm-5.2",
        reasoningEffort: "max" as const,
        expected: { thinking: { type: "enabled" }, reasoning_effort: "max" }
      },
      {
        apiBaseUrl: "https://api.moonshot.cn/v1",
        modelName: "kimi-k2.5",
        reasoningEffort: "high" as const,
        expected: { thinking: { type: "enabled" } }
      },
      {
        apiBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        modelName: "qwen3.7-plus",
        reasoningEffort: "medium" as const,
        expected: { enable_thinking: true, thinking_budget: 16_384 }
      }
    ];
    for (const testCase of cases) {
      const fetchImpl = vi.fn(async () => jsonResponse({ choices: [{ message: { content: "ok" } }] }));
      const provider = createOpenAICompatibleProvider({ ...testCase, fetch: fetchImpl });
      await provider.complete({ messages });
      const calls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
      expect(JSON.parse(calls[0][1].body as string)).toMatchObject(testCase.expected);
    }
  });

  it("returns and reports token usage from a non-streaming response", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        choices: [{ message: { content: "你好" } }],
        usage: { prompt_tokens: 120, completion_tokens: 45 }
      })
    );
    const onUsage = vi.fn();
    const provider = createOpenAICompatibleProvider({
      apiBaseUrl: "https://api.deepseek.com",
      apiKey: "sk-test",
      modelName: "deepseek-v4-flash",
      fetch: fetchImpl,
      onUsage
    });

    const response = await provider.complete({ messages });

    expect(response.usage).toEqual({ inputTokens: 120, outputTokens: 45 });
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 120, outputTokens: 45 });
  });

  it("reports token usage from a streaming response before the done event", async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":88,"completion_tokens":12}}\n\n',
        "data: [DONE]\n\n"
      ])
    );
    const onUsage = vi.fn();
    const provider = createOpenAICompatibleProvider({
      apiBaseUrl: "https://api.deepseek.com",
      apiKey: "sk-test",
      modelName: "deepseek-v4-flash",
      fetch: fetchImpl,
      onUsage
    });

    const events = [];
    for await (const event of provider.stream({ messages })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "status", status: "connecting" },
      { type: "status", status: "thinking" },
      { type: "status", status: "streaming" },
      { type: "chunk", content: "你" },
      { type: "usage", inputTokens: 88, outputTokens: 12 },
      { type: "status", status: "done" }
    ]);
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 88, outputTokens: 12 });
  });

  it("requests stream usage reporting only for non-loopback endpoints", async () => {
    const remoteFetch = vi.fn(async () => sseResponse(["data: [DONE]\n\n"]));
    const localFetch = vi.fn(async () => sseResponse(["data: [DONE]\n\n"]));

    const remoteProvider = createOpenAICompatibleProvider({
      apiBaseUrl: "https://api.deepseek.com",
      apiKey: "sk-test",
      modelName: "deepseek-v4-flash",
      fetch: remoteFetch
    });
    for await (const _event of remoteProvider.stream({ messages })) {
      // Drain the stream.
    }
    const remoteCalls = remoteFetch.mock.calls as unknown as Array<[string, RequestInit]>;
    const remoteBody = JSON.parse(remoteCalls[0][1].body as string) as Record<string, unknown>;
    expect(remoteBody.stream_options).toEqual({ include_usage: true });

    const localProvider = createOpenAICompatibleProvider({
      apiBaseUrl: "http://127.0.0.1:11434/v1",
      modelName: "qwen3:8b",
      fetch: localFetch
    });
    for await (const _event of localProvider.stream({ messages })) {
      // Drain the stream.
    }
    const localCalls = localFetch.mock.calls as unknown as Array<[string, RequestInit]>;
    const localBody = JSON.parse(localCalls[0][1].body as string) as Record<string, unknown>;
    expect(localBody).not.toHaveProperty("stream_options");
  });

  it("surfaces a sanitized 400 body when a vendor rejects thinking", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { message: "Unknown parameter: thinking" } }, { status: 400 })
    );
    const provider = createOpenAICompatibleProvider({
      apiBaseUrl: "https://api.example.test/v1",
      apiKey: "sk-secret-abc",
      modelName: "deepseek-chat",
      fetch: fetchImpl
    });

    try {
      await provider.complete({ messages });
      throw new Error("expected LlmProviderError");
    } catch (error) {
      expect(error).toBeInstanceOf(LlmProviderError);
      const err = error as LlmProviderError;
      expect(err.status).toBe(400);
      expect(err.message).toMatch(/HTTP 400/);
      expect(err.message).toMatch(/Unknown parameter: thinking/);
      expect(String(error)).not.toContain("sk-secret-abc");
      expect(String(error)).not.toContain("你好");
    }
  });

});
