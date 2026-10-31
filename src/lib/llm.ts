// Thin LLM wrapper so the provider can be swapped (LLM_PROVIDER=anthropic|groq).
// Callers only see callJson() and llmProfile().
import type { z } from "zod";
import { createLimiter, type Limiter } from "./limit";
import {
  anthropicComplete, groqComplete, LlmError, provider, type CompleteOptions, type Provider,
} from "./llm-providers";

export { LlmError, resolveModel, provider, DEFAULT_MODELS, KEY_ENV } from "./llm-providers";
export type { Effort, Provider } from "./llm-providers";
export type CallJsonOptions = CompleteOptions;

/** The single primitive the rest of the app depends on: prompt in, text out. */
export type CompleteFn = (prompt: string, opts: CallJsonOptions) => Promise<string>;

/**
 * Per-provider budgets. Groq's free tier has low tokens-per-minute limits, so it reads less of
 * each page, fewer pages, and runs fewer calls at once (and is allowed more wall-clock time).
 */
export interface LlmProfile {
  concurrency: number;
  maxPages: number;
  pageChars: number;
  maxFacts: number;
  verifyBatch: number;
  jobCapMs: number;
}

const PROFILES: Record<Provider, LlmProfile> = {
  anthropic: { concurrency: 6, maxPages: 10, pageChars: 48_000, maxFacts: 70, verifyBatch: 20, jobCapMs: 5 * 60_000 },
  groq: { concurrency: 1, maxPages: 6, pageChars: 14_000, maxFacts: 30, verifyBatch: 25, jobCapMs: 15 * 60_000 },
};

export function llmProfile(): LlmProfile {
  return PROFILES[provider()] ?? PROFILES.anthropic;
}

// Cap on in-flight LLM requests across all jobs, per provider (created on first use).
const limiters = new Map<Provider, Limiter>();

const defaultComplete: CompleteFn = (prompt, opts) => {
  const p = provider();
  let limiter = limiters.get(p);
  if (!limiter) limiters.set(p, (limiter = createLimiter(PROFILES[p].concurrency)));
  return limiter(() => (p === "groq" ? groqComplete(prompt, opts) : anthropicComplete(prompt, opts)));
};

/** Pull the first JSON object out of a model reply (tolerates stray fences or prose). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new SyntaxError("No JSON object found in model output");
  return JSON.parse(candidate.slice(start, end + 1));
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 20)
    .map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
}

/**
 * Call the LLM and validate its JSON against a Zod schema. On parse/validation failure,
 * retry once with the errors appended; then throw LlmError (hard rule 3 in CLAUDE.md).
 */
export async function callJson<S extends z.ZodTypeAny>(
  prompt: string,
  schema: S,
  opts: CallJsonOptions = {},
  complete: CompleteFn = defaultComplete,
): Promise<z.infer<S>> {
  let lastProblem = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const fullPrompt =
      attempt === 0
        ? prompt
        : `${prompt}\n\nYour previous reply was invalid:\n${lastProblem}\nReturn corrected JSON only.`;
    const text = await complete(fullPrompt, opts);
    let data: unknown;
    try {
      data = extractJson(text);
    } catch (err) {
      lastProblem = `- not valid JSON: ${err instanceof Error ? err.message : String(err)}`;
      continue;
    }
    const parsed = schema.safeParse(data);
    if (parsed.success) return parsed.data;
    lastProblem = describeIssues(parsed.error);
  }
  throw new LlmError(provider(), "bad_output", `LLM output failed validation after retry:\n${lastProblem}`, { label: opts.label });
}
