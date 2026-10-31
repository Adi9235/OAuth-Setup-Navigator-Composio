// Provider adapters behind llm.ts. Each turns (prompt, opts) into reply text, or throws a typed
// LlmError (see service-error.ts). LLM_PROVIDER picks one; Groq is the default, Claude the alternative.
import Anthropic from "@anthropic-ai/sdk";
import { currentCredentials, type Credentials, type Provider } from "./credentials";
import { ServiceError, type ServiceErrorCode } from "./service-error";

export type { Provider };
export type Effort = "low" | "medium" | "high";

export interface CompleteOptions {
  system?: string;
  effort?: Effort;
  maxTokens?: number;
  label?: string;
}

export class LlmError extends ServiceError {
  constructor(provider: string, code: ServiceErrorCode, message: string, opts: { label?: string; retryAfterSec?: number } = {}) {
    super("llm", provider, code, message, opts.retryAfterSec, opts.label);
    this.name = "LlmError";
  }
}

export const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: "claude-sonnet-5-5",
  groq: "openai/gpt-oss-120b",
};

export const KEY_ENV: Record<Provider, "ANTHROPIC_API_KEY" | "GROQ_API_KEY"> = {
  anthropic: "ANTHROPIC_API_KEY",
  groq: "GROQ_API_KEY",
};

/** Provider for the current job (visitor's choice from Settings, else LLM_PROVIDER). */
export function provider(): Provider {
  return currentCredentials().provider;
}

/** The chosen model if it belongs to the active provider, else that provider's default. */
export function resolveModel(creds: Credentials = currentCredentials()): string {
  const p = creds.provider;
  const m = creds.model;
  if (!m) return DEFAULT_MODELS[p];
  const isClaude = m.startsWith("claude-");
  return (p === "anthropic") === isClaude ? m : DEFAULT_MODELS[p];
}

export function keyFor(p: Provider, label?: string, creds: Credentials = currentCredentials()): string {
  const key = p === "groq" ? creds.groqKey : creds.anthropicKey;
  if (!key) throw new LlmError(p, "missing_key", `${KEY_ENV[p]} is not set`, { label });
  return key;
}

export const JSON_SYSTEM =
  "You are a careful research assistant. Respond with a single JSON object only — no prose, no markdown fences.";

const systemFor = (opts: CompleteOptions) => (opts.system ? `${JSON_SYSTEM}\n\n${opts.system}` : JSON_SYSTEM);

/** Parse durations like "697ms", "7.5s", "4m40.368s", "1h2m" into seconds. */
export function parseDurationSec(text: string | null | undefined): number | undefined {
  if (!text) return undefined;
  let ms = 0;
  for (const [, n, unit] of text.matchAll(/([\d.]+)(ms|h|m|s)(?![a-z])/g))
    ms += Number(n) * ({ ms: 1, s: 1000, m: 60_000, h: 3_600_000 } as Record<string, number>)[unit];
  return ms > 0 ? ms / 1000 : undefined;
}

// ---------- Anthropic (Claude) ----------

// Models that accept the server-side refusal fallback ("default" routing).
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-opus-5", "claude-fable-5-1"]);
let anthropic: { key: string; client: Anthropic } | undefined;

/** Map SDK errors to typed LlmErrors (never includes request bodies or keys). */
export function anthropicError(err: unknown, label?: string): LlmError {
  const e = (code: ServiceErrorCode, msg: string, retryAfterSec?: number) => new LlmError("anthropic", code, msg, { label, retryAfterSec });
  if (err instanceof LlmError) return err;
  if (err instanceof Anthropic.AuthenticationError) return e("invalid_key", "Anthropic rejected ANTHROPIC_API_KEY");
  if (err instanceof Anthropic.PermissionDeniedError) return e("model_not_found", `This key cannot use model ${resolveModel()}`);
  if (err instanceof Anthropic.NotFoundError) return e("model_not_found", `Model ${resolveModel()} was not found`);
  if (err instanceof Anthropic.RateLimitError)
    return e("rate_limited", "Anthropic rate limit reached", Number(err.headers?.get?.("retry-after")) || undefined);
  if (err instanceof Anthropic.BadRequestError)
    return /credit balance/i.test(err.message)
      ? e("no_credit", "Anthropic account has no credit balance")
      : e("rejected", `Request rejected: ${err.message.slice(0, 200)}`);
  if (err instanceof Anthropic.APIConnectionError) return e("network", "Could not reach the Anthropic API");
  if (err instanceof Anthropic.InternalServerError || (err instanceof Anthropic.APIError && (err.status ?? 0) >= 500))
    return e("unavailable", `Anthropic API error ${(err as InstanceType<typeof Anthropic.APIError>).status ?? ""}`.trim());
  if (err instanceof Anthropic.APIError) return e("rejected", `Anthropic API error ${err.status ?? ""}`.trim());
  return e("rejected", err instanceof Error ? err.message : String(err));
}

export async function anthropicComplete(prompt: string, opts: CompleteOptions): Promise<string> {
  const key = keyFor("anthropic", opts.label);
  if (anthropic?.key !== key) anthropic = { key, client: new Anthropic({ apiKey: key, maxRetries: 3 }) };
  const model = resolveModel();
  const fallback = FALLBACK_MODELS.has(model)
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
    : {};
  let response;
  try {
    response = await anthropic.client.beta.messages.create({
      model,
      max_tokens: opts.maxTokens ?? 16000,
      system: systemFor(opts),
      output_config: { effort: opts.effort ?? "medium" },
      messages: [{ role: "user", content: prompt }],
      ...fallback,
    });
  } catch (err) {
    throw anthropicError(err, opts.label);
  }
  const fail = (msg: string) => new LlmError("anthropic", "bad_output", msg, { label: opts.label });
  if (response.stop_reason === "refusal") throw fail("The model declined this request");
  if (response.stop_reason === "max_tokens") throw fail("Model output was cut off (max_tokens)");
  const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  if (!text) throw fail("Model returned no text");
  return text;
}

// ---------- Groq (OpenAI-compatible chat completions) ----------

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
// Free tier: ~8k tokens/minute, so keep requested output small (it includes reasoning on gpt-oss).
const GROQ_MAX_OUTPUT = 6000;
const MAX_ATTEMPTS = 8;
const MAX_WAIT_PER_CALL_SEC = 180; // per-minute limits: wait at most this long in total, then give up
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface GroqResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  error?: { message?: string; code?: string; type?: string; failed_generation?: string };
}

/** Seconds to wait from retry-after or x-ratelimit-reset-tokens. */
export function retryAfterSec(headers: Headers): number | undefined {
  const ra = Number(headers.get("retry-after"));
  if (Number.isFinite(ra) && ra > 0) return ra;
  return parseDurationSec(headers.get("x-ratelimit-reset-tokens"));
}

/** Groq 429s: per-day limits (TPD/RPD) are not worth waiting for; per-minute ones are. */
export function classifyGroq429(message: string, headers: Headers): { daily: boolean; waitSec?: number } {
  const daily = /per day|\(TPD\)|\(RPD\)/i.test(message);
  const fromMessage = parseDurationSec(/try again in ([\dhms.]+)/i.exec(message)?.[1]);
  return { daily, waitSec: fromMessage ?? retryAfterSec(headers) };
}

export async function groqComplete(prompt: string, opts: CompleteOptions): Promise<string> {
  const key = keyFor("groq", opts.label);
  const model = resolveModel();
  const err = (code: ServiceErrorCode, msg: string, retryAfter?: number) =>
    new LlmError("groq", code, msg, { label: opts.label, retryAfterSec: retryAfter });
  // gpt-oss models reason before answering; keep reasoning short (it counts against the per-minute
  // token budget) and hidden. "high" is the only effort that asks for more.
  const reasoning = model.startsWith("openai/gpt-oss")
    ? { reasoning_effort: opts.effort === "high" ? "medium" : "low", include_reasoning: false }
    : {};
  const body = JSON.stringify({
    model,
    messages: [
      { role: "system", content: systemFor(opts) },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
    max_tokens: Math.min(opts.maxTokens ?? GROQ_MAX_OUTPUT, GROQ_MAX_OUTPUT),
    ...reasoning,
  });

  let waited = 0;
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(GROQ_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body,
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      if (attempt >= 3) throw err("network", "Could not reach the Groq API");
      await sleep(2000 * attempt);
      continue;
    }

    if (res.status === 429) {
      const data = (await res.json().catch(() => ({}))) as GroqResponse;
      const { daily, waitSec } = classifyGroq429(data.error?.message ?? "", res.headers);
      if (daily) throw err("quota_exhausted", `Groq daily limit reached for ${model}`, waitSec);
      const wait = Math.min(waitSec ?? 3 * attempt, 60);
      if (attempt >= MAX_ATTEMPTS || waited + wait > MAX_WAIT_PER_CALL_SEC)
        throw err("rate_limited", "Groq per-minute rate limit kept being hit", waitSec);
      waited += wait;
      await sleep(wait * 1000 + 250);
      continue;
    }
    if (res.status >= 500) {
      await res.body?.cancel();
      if (attempt >= 3) throw err("unavailable", `Groq API error ${res.status}`);
      await sleep(3000 * attempt);
      continue;
    }

    const data = (await res.json().catch(() => ({}))) as GroqResponse;
    if (!res.ok) {
      // JSON mode rejected malformed output: hand it back so callJson retries with the error.
      if (data.error?.code === "json_validate_failed") return data.error.failed_generation ?? "";
      if (res.status === 401) throw err("invalid_key", "Groq rejected GROQ_API_KEY");
      if (res.status === 403) throw err("model_not_found", `This key cannot use model ${model}`);
      if (res.status === 404 || data.error?.code === "model_not_found") throw err("model_not_found", `Model ${model} is not available on Groq for this key`);
      if (res.status === 413) throw err("rejected", "Request too large for this Groq model/tier");
      throw err("rejected", `Groq request rejected (${res.status}): ${(data.error?.message ?? "").slice(0, 200)}`);
    }
    const choice = data.choices?.[0];
    if (choice?.finish_reason === "length") throw err("bad_output", "Model output was cut off (max_tokens)");
    const text = choice?.message?.content?.trim();
    if (!text) throw err("bad_output", "Model returned no text");
    return text;
  }
}
