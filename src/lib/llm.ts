// Thin LLM wrapper so the provider can be swapped. Callers only see callJson().
import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { env, requireEnv } from "./env";
import { createLimiter } from "./limit";

export type Effort = "low" | "medium" | "high";

export interface CallJsonOptions {
  system?: string;
  effort?: Effort;
  maxTokens?: number;
  /** Label used in error messages, e.g. "extract". */
  label?: string;
}

/** The single primitive the rest of the app depends on: prompt in, text out. */
export type CompleteFn = (prompt: string, opts: CallJsonOptions) => Promise<string>;

export class LlmError extends Error {
  constructor(
    message: string,
    readonly label?: string,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

const JSON_SYSTEM =
  "You are a careful research assistant. Respond with a single JSON object only — no prose, no markdown fences.";

// Models that accept the server-side refusal fallback ("default" routing).
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-opus-5", "claude-fable-5-1"]);

// Global cap on in-flight LLM requests across all jobs.
const llmLimit = createLimiter(6);
let client: Anthropic | undefined;

const anthropicComplete: CompleteFn = async (prompt, opts) => {
  client ??= new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY"), maxRetries: 3 });
  const model = env().LLM_MODEL;
  const params = {
    model,
    max_tokens: opts.maxTokens ?? 16000,
    system: opts.system ? `${JSON_SYSTEM}\n\n${opts.system}` : JSON_SYSTEM,
    output_config: { effort: opts.effort ?? "medium" },
    messages: [{ role: "user" as const, content: prompt }],
  };

  const fallback = FALLBACK_MODELS.has(model)
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
    : {};
  const response = await llmLimit(() => client!.beta.messages.create({ ...params, ...fallback }));

  if (response.stop_reason === "refusal")
    throw new LlmError("The model declined this request", opts.label);
  if (response.stop_reason === "max_tokens")
    throw new LlmError("Model output was cut off (max_tokens)", opts.label);

  const text = response.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
  if (!text) throw new LlmError("Model returned no text", opts.label);
  return text;
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
  complete: CompleteFn = anthropicComplete,
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
  throw new LlmError(`LLM output failed validation after retry:\n${lastProblem}`, opts.label);
}
