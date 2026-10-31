import { afterEach, describe, expect, it, vi } from "vitest";

const envState: Record<string, unknown> = {};
vi.mock("./env", () => ({
  env: () => envState,
  requireEnv: (k: string) => {
    if (!envState[k]) throw new Error(`${k} is not set`);
    return envState[k];
  },
}));

const { groqComplete, resolveModel, LlmError } = await import("./llm-providers");

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of Object.keys(envState)) delete envState[k];
});

const ok = (content: string) =>
  Response.json({ choices: [{ message: { content }, finish_reason: "stop" }] });

describe("resolveModel", () => {
  it("uses each provider's default and ignores a model from the other provider", () => {
    Object.assign(envState, { LLM_PROVIDER: "anthropic" });
    expect(resolveModel()).toBe("claude-sonnet-5-5");
    Object.assign(envState, { LLM_PROVIDER: "groq", LLM_MODEL: "claude-sonnet-5-5" });
    expect(resolveModel()).toBe("openai/gpt-oss-120b");
    Object.assign(envState, { LLM_MODEL: "qwen/qwen3.8-27b" });
    expect(resolveModel()).toBe("qwen/qwen3.8-27b");
  });
});

describe("groqComplete", () => {
  it("sends JSON mode and returns the message content", async () => {
    Object.assign(envState, { LLM_PROVIDER: "groq", GROQ_API_KEY: "gk" });
    const fetchMock = vi.fn().mockResolvedValue(ok('{"a":1}'));
    vi.stubGlobal("fetch", fetchMock);
    await expect(groqComplete("p", {})).resolves.toBe('{"a":1}');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer gk");
  });

  it("waits and retries on 429", async () => {
    Object.assign(envState, { LLM_PROVIDER: "groq", GROQ_API_KEY: "gk" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("slow down", { status: 429, headers: { "retry-after": "0.01" } }))
      .mockResolvedValueOnce(ok('{"b":2}'));
    vi.stubGlobal("fetch", fetchMock);
    await expect(groqComplete("p", {})).resolves.toBe('{"b":2}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("hands back failed JSON-mode generations so callJson can retry", async () => {
    Object.assign(envState, { LLM_PROVIDER: "groq", GROQ_API_KEY: "gk" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      Response.json({ error: { code: "json_validate_failed", failed_generation: "{oops" } }, { status: 400 }),
    ));
    await expect(groqComplete("p", {})).resolves.toBe("{oops");
  });

  it("maps 401 to a clear error", async () => {
    Object.assign(envState, { LLM_PROVIDER: "groq", GROQ_API_KEY: "bad" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { message: "invalid" } }, { status: 401 })));
    const err = await groqComplete("p", {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as Error).message).toMatch(/GROQ_API_KEY/);
  });
});
