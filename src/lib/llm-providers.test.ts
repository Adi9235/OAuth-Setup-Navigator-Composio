import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

const envState: Record<string, unknown> = {};
vi.mock("./env", () => ({ env: () => envState }));

const { anthropicError, classifyGroq429, groqComplete, parseDurationSec, resolveModel, LlmError } = await import("./llm-providers");

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of Object.keys(envState)) delete envState[k];
});

const ok = (content: string) => Response.json({ choices: [{ message: { content }, finish_reason: "stop" }] });
const groq = () => Object.assign(envState, { LLM_PROVIDER: "groq", GROQ_API_KEY: "gk" });
const DAILY_429 = {
  error: {
    message: "Rate limit reached for model `openai/gpt-oss-120b` in organization `org_x` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 199332, Requested 1317. Please try again in 4m40.368s.",
    type: "tokens",
    code: "rate_limit_exceeded",
  },
};

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

describe("rate-limit parsing", () => {
  it("parses Groq durations", () => {
    expect(parseDurationSec("697ms")).toBeCloseTo(0.697);
    expect(parseDurationSec("7.5s")).toBe(7.5);
    expect(parseDurationSec("4m40.368s")).toBeCloseTo(280.368);
    expect(parseDurationSec("1h2m")).toBe(3720);
    expect(parseDurationSec(null)).toBeUndefined();
  });

  it("tells daily limits from per-minute limits", () => {
    expect(classifyGroq429(DAILY_429.error.message, new Headers())).toMatchObject({ daily: true });
    expect(classifyGroq429(DAILY_429.error.message, new Headers()).waitSec).toBeCloseTo(280.368);
    const perMinute = classifyGroq429("Rate limit reached ... tokens per minute (TPM): Limit 8000. Please try again in 7.5s.", new Headers());
    expect(perMinute).toEqual({ daily: false, waitSec: 7.5 });
    expect(classifyGroq429("", new Headers({ "retry-after": "12" }))).toEqual({ daily: false, waitSec: 12 });
  });
});

describe("groqComplete", () => {
  it("sends JSON mode with the key and returns the content", async () => {
    groq();
    const fetchMock = vi.fn().mockResolvedValue(ok('{"a":1}'));
    vi.stubGlobal("fetch", fetchMock);
    await expect(groqComplete("p", {})).resolves.toBe('{"a":1}');
    const init = fetchMock.mock.calls[0][1];
    expect(JSON.parse(init.body).response_format).toEqual({ type: "json_object" });
    expect(init.headers.Authorization).toBe("Bearer gk");
  });

  it("fails with missing_key before calling the API", async () => {
    Object.assign(envState, { LLM_PROVIDER: "groq" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(groqComplete("p", {})).rejects.toMatchObject({ code: "missing_key", provider: "groq" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("waits and retries on a per-minute 429", async () => {
    groq();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ error: { message: "tokens per minute (TPM). Please try again in 0.01s." } }, { status: 429 }))
      .mockResolvedValueOnce(ok('{"b":2}'));
    vi.stubGlobal("fetch", fetchMock);
    await expect(groqComplete("p", {})).resolves.toBe('{"b":2}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails fast with quota_exhausted on the daily limit (no waiting)", async () => {
    groq();
    const fetchMock = vi.fn().mockResolvedValue(Response.json(DAILY_429, { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    const t0 = Date.now();
    const err = await groqComplete("p", { label: "extract" }).catch((e: unknown) => e);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(err).toBeInstanceOf(LlmError);
    expect(err).toMatchObject({ code: "quota_exhausted", provider: "groq", label: "extract" });
    expect((err as InstanceType<typeof LlmError>).retryAfterSec).toBeCloseTo(280.368);
  });

  it("hands back failed JSON-mode generations so callJson can retry", async () => {
    groq();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      Response.json({ error: { code: "json_validate_failed", failed_generation: "{oops" } }, { status: 400 }),
    ));
    await expect(groqComplete("p", {})).resolves.toBe("{oops");
  });

  it("maps 401 and 404 to invalid_key and model_not_found", async () => {
    groq();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { message: "invalid" } }, { status: 401 })));
    await expect(groqComplete("p", {})).rejects.toMatchObject({ code: "invalid_key" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { code: "model_not_found" } }, { status: 404 })));
    await expect(groqComplete("p", {})).rejects.toMatchObject({ code: "model_not_found" });
  });

  it("maps network failures to network after retries", async () => {
    groq();
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const p = groqComplete("p", {}).catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    expect(await p).toMatchObject({ code: "network" });
    vi.useRealTimers();
  });
});

describe("anthropicError", () => {
  const h = new Headers();
  it("maps SDK errors to typed codes", () => {
    Object.assign(envState, { LLM_PROVIDER: "anthropic" });
    expect(anthropicError(new Anthropic.AuthenticationError(401, undefined, "bad key", h))).toMatchObject({ code: "invalid_key" });
    expect(anthropicError(new Anthropic.BadRequestError(400, undefined, "Your credit balance is too low to access the Anthropic API.", h))).toMatchObject({ code: "no_credit" });
    expect(anthropicError(new Anthropic.BadRequestError(400, undefined, "prompt is too long", h))).toMatchObject({ code: "rejected" });
    expect(anthropicError(new Anthropic.RateLimitError(429, undefined, "slow down", new Headers({ "retry-after": "30" })))).toMatchObject({ code: "rate_limited", retryAfterSec: 30 });
    expect(anthropicError(new Anthropic.NotFoundError(404, undefined, "no model", h))).toMatchObject({ code: "model_not_found" });
    expect(anthropicError(new Anthropic.InternalServerError(529, undefined, "overloaded", h))).toMatchObject({ code: "unavailable" });
    expect(anthropicError(new Anthropic.APIConnectionError({ message: "down" }))).toMatchObject({ code: "network" });
  });
});
