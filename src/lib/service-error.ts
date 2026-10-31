// Typed errors for external services (LLM providers, web search) and the user-facing explanation
// shown on the job page. Pure module: safe to import from client components.

export type ServiceName = "llm" | "search";

export type ServiceErrorCode =
  | "missing_key" // key not configured on this server
  | "invalid_key" // provider rejected the key
  | "quota_exhausted" // daily/monthly allowance used up (free tiers)
  | "no_credit" // paid account has no balance
  | "rate_limited" // per-minute limit, still hit after waiting
  | "model_not_found" // LLM_MODEL not available for this key
  | "network" // could not reach the provider
  | "unavailable" // provider returned 5xx after retries
  | "rejected" // provider refused this one request (e.g. too large)
  | "bad_output"; // model output unusable for this one request

/** Codes that make the whole job impossible — stop immediately instead of producing a thin guide. */
const FATAL: ReadonlySet<ServiceErrorCode> = new Set([
  "missing_key", "invalid_key", "quota_exhausted", "no_credit", "rate_limited", "model_not_found", "network", "unavailable",
]);

export class ServiceError extends Error {
  constructor(
    readonly service: ServiceName,
    readonly provider: string,
    readonly code: ServiceErrorCode,
    message: string,
    readonly retryAfterSec?: number,
    readonly label?: string,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export function isFatal(err: unknown): err is ServiceError {
  return err instanceof ServiceError && FATAL.has(err.code);
}

/** First fatal service error among rejected results, if any. */
export function firstFatal(results: PromiseSettledResult<unknown>[]): ServiceError | undefined {
  for (const r of results) if (r.status === "rejected" && isFatal(r.reason)) return r.reason;
  return undefined;
}

export interface ErrorExplanation {
  code: ServiceErrorCode | "internal";
  title: string;
  detail: string;
  hint?: string;
  retryAfterSec?: number;
}

const PROVIDER_LABEL: Record<string, string> = { groq: "Groq", anthropic: "Anthropic (Claude)", tavily: "Tavily" };
const KEY_NAME: Record<string, string> = { groq: "GROQ_API_KEY", anthropic: "ANTHROPIC_API_KEY", tavily: "TAVILY_API_KEY" };

export function formatWait(sec?: number): string {
  if (!sec || sec <= 0) return "a few minutes";
  if (sec < 90) return `${Math.ceil(sec)} seconds`;
  if (sec < 5400) return `${Math.ceil(sec / 60)} minutes`;
  return `${Math.round(sec / 3600)} hours`;
}

/** Plain-language explanation of why a job failed and what to do about it. */
export function explainError(err: unknown): ErrorExplanation {
  if (!(err instanceof ServiceError)) {
    return {
      code: "internal",
      title: "Something went wrong while generating this guide",
      detail: err instanceof Error && err.message ? err.message : "Unknown error",
      hint: "Try again. If it keeps happening, check the server logs.",
    };
  }
  const name = PROVIDER_LABEL[err.provider] ?? err.provider;
  const key = KEY_NAME[err.provider] ?? "the API key";
  const what = err.service === "llm" ? "the AI model" : "web search";
  const switchHint =
    err.provider === "groq" ? " Or switch to Claude: set LLM_PROVIDER=anthropic and ANTHROPIC_API_KEY."
    : err.provider === "anthropic" ? " Or switch to Groq's free tier: set LLM_PROVIDER=groq and GROQ_API_KEY."
    : "";
  const base = { code: err.code, retryAfterSec: err.retryAfterSec };

  switch (err.code) {
    case "missing_key":
      return { ...base, title: `${name} API key is not configured`, detail: `This server has no ${key}, so it can't use ${what}.`, hint: `Add ${key} to .env (or the host's environment variables) and restart the server.` };
    case "invalid_key":
      return { ...base, title: `${name} rejected the API key`, detail: `${key} is set but ${name} says it is invalid or revoked.`, hint: `Create a new key in the ${name} console and update ${key}.` };
    case "quota_exhausted":
      return err.service === "llm"
        ? { ...base, title: `${name} usage limit reached`, detail: `The account behind ${key} has used its ${err.provider === "groq" ? "free daily token allowance" : "usage allowance"} for this model. The app itself is working.`, hint: `Try again in ${formatWait(err.retryAfterSec)}, or use your own ${key}.${switchHint}` }
        : { ...base, title: `${name} search credits used up`, detail: `The account behind ${key} has no search credits left this period. The app itself is working.`, hint: `Use your own ${key} (free at tavily.com) or wait for the allowance to reset.` };
    case "no_credit":
      return { ...base, title: `${name} account has no credit`, detail: `${key} is valid, but the account has no balance to run requests.`, hint: `Add credits in the Claude Console (Billing).${switchHint}` };
    case "rate_limited":
      return { ...base, title: `${name} rate limit reached`, detail: `Too many requests in a short time${err.provider === "groq" ? " (Groq's free tier allows only a few thousand tokens per minute)" : ""}.`, hint: `Wait ${formatWait(err.retryAfterSec)} and try again; generate one guide at a time.` };
    case "model_not_found":
      return { ...base, title: "The configured model isn't available", detail: err.message, hint: "Check LLM_MODEL, or remove it to use the provider's default model." };
    case "network":
      return { ...base, title: `Couldn't reach ${name}`, detail: "The request did not get a response.", hint: "Check the server's internet connection and try again." };
    case "unavailable":
      return { ...base, title: `${name} is having problems`, detail: "The provider returned server errors after several retries.", hint: "Try again in a few minutes." };
    default:
      return { ...base, title: `${name} couldn't complete a request`, detail: err.message };
  }
}
