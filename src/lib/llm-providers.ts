// Provider adapters behind llm.ts. Each turns (prompt, opts) into reply text.
// LLM_PROVIDER picks one; Groq is the default, Claude (Anthropic) the alternative.
import Anthropic from "@anthropic-ai/sdk";
import { env, requireEnv } from "./env";

export type Provider = "anthropic" | "groq";
export type Effort = "low" | "medium" | "high";

export interface CompleteOptions {
  system?: string;
  effort?: Effort;
  maxTokens?: number;
  label?: string;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly label?: string,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: "claude-sonnet-5-5",
  groq: "openai/gpt-oss-120b",
};

export function provider(): Provider {
  return env().LLM_PROVIDER;
}

/** LLM_MODEL if it belongs to the active provider, else that provider's default. */
export function resolveModel(): string {
  const p = provider();
  const m = env().LLM_MODEL;
  if (!m) return DEFAULT_MODELS[p];
  const isClaude = m.startsWith("claude-");
  return (p === "anthropic") === isClaude ? m : DEFAULT_MODELS[p];
}

export const JSON_SYSTEM =
  "You are a careful research assistant. Respond with a single JSON object only — no prose, no markdown fences.";

const systemFor = (opts: CompleteOptions) => (opts.system ? `${JSON_SYSTEM}\n\n${opts.system}` : JSON_SYSTEM);

// ---------- Anthropic (Claude) ----------

// Models that accept the server-side refusal fallback ("default" routing).
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-opus-5", "claude-fable-5-1"]);
let anthropic: Anthropic | undefined;

/** Turn SDK errors into short, actionable job messages (no request bodies or keys). */
function anthropicError(err: unknown, label?: string): LlmError {
  if (err instanceof Anthropic.AuthenticationError) return new LlmError("LLM authentication failed — check ANTHROPIC_API_KEY", label);
  if (err instanceof Anthropic.PermissionDeniedError) return new LlmError("This API key cannot use the configured LLM_MODEL", label);
  if (err instanceof Anthropic.NotFoundError) return new LlmError(`Model not found — check LLM_MODEL (${resolveModel()})`, label);
  if (err instanceof Anthropic.RateLimitError) return new LlmError("LLM rate limit reached — try again in a minute", label);
  if (err instanceof Anthropic.BadRequestError)
    return new LlmError(/credit balance/i.test(err.message)
      ? "Anthropic account has no credit balance — add credits in the Claude Console (Billing), or set LLM_PROVIDER=groq"
      : `LLM request rejected: ${err.message.slice(0, 200)}`, label);
  if (err instanceof Anthropic.APIConnectionError) return new LlmError("Could not reach the LLM API (network)", label);
  if (err instanceof Anthropic.APIError) return new LlmError(`LLM API error ${err.status ?? ""}`.trim(), label);
  return err instanceof LlmError ? err : new LlmError(err instanceof Error ? err.message : String(err), label);
}

export async function anthropicComplete(prompt: string, opts: CompleteOptions): Promise<string> {
  anthropic ??= new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY"), maxRetries: 3 });
  const model = resolveModel();
  const fallback = FALLBACK_MODELS.has(model)
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
    : {};
  let response;
  try {
    response = await anthropic.beta.messages.create({
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
  if (response.stop_reason === "refusal") throw new LlmError("The model declined this request", opts.label);
  if (response.stop_reason === "max_tokens") throw new LlmError("Model output was cut off (max_tokens)", opts.label);
  const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  if (!text) throw new LlmError("Model returned no text", opts.label);
  return text;
}

// ---------- Groq (OpenAI-compatible chat completions) ----------

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MAX_OUTPUT = 16384; // includes reasoning tokens on gpt-oss
const MAX_ATTEMPTS = 6;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface GroqResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  error?: { message?: string; code?: string; failed_generation?: string };
}

export async function groqComplete(prompt: string, opts: CompleteOptions): Promise<string> {
  const key = requireEnv("GROQ_API_KEY");
  const model = resolveModel();
  // gpt-oss models reason before answering; map our effort onto theirs and hide the reasoning.
  const reasoning = model.startsWith("openai/gpt-oss")
    ? { reasoning_effort: opts.effort === "high" ? "high" : opts.effort === "low" ? "low" : "medium", include_reasoning: false }
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
      if (attempt >= MAX_ATTEMPTS) throw new LlmError("Could not reach the Groq API (network)", opts.label);
      await sleep(2000 * attempt);
      continue;
    }

    // Free-tier rate limits: wait as told (capped) and retry.
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= MAX_ATTEMPTS)
        throw new LlmError(res.status === 429 ? "Groq rate limit reached — wait a minute and retry (free tier)" : `Groq API error ${res.status}`, opts.label);
      const retryAfter = Number(res.headers.get("retry-after"));
      await res.body?.cancel();
      await sleep(Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 + 250 : 3000 * attempt, 60_000));
      continue;
    }

    const data = (await res.json().catch(() => ({}))) as GroqResponse;
    if (!res.ok) {
      // JSON mode rejected malformed output: hand it back so callJson retries with the error.
      if (data.error?.code === "json_validate_failed") return data.error.failed_generation ?? "";
      if (res.status === 401) throw new LlmError("Groq authentication failed — check GROQ_API_KEY", opts.label);
      if (res.status === 404) throw new LlmError(`Groq model not found — check LLM_MODEL (${resolveModel()})`, opts.label);
      if (res.status === 413) throw new LlmError("Request too large for this Groq model/tier", opts.label);
      throw new LlmError(`Groq request rejected (${res.status}): ${(data.error?.message ?? "").slice(0, 200)}`, opts.label);
    }
    const choice = data.choices?.[0];
    if (choice?.finish_reason === "length") throw new LlmError("Model output was cut off (max_tokens)", opts.label);
    const text = choice?.message?.content?.trim();
    if (!text) throw new LlmError("Model returned no text", opts.label);
    return text;
  }
}
