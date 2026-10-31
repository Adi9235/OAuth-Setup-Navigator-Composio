// Per-job API credentials ("bring your own key" from the Settings page).
// Keys a visitor enters live only in their browser; they are sent when starting a job, held in this
// process's memory until the job starts, and scoped to that job with AsyncLocalStorage. They are
// never written to the database or logs. Without user keys, the server's .env keys are used.
import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import { env } from "./env";

export type Provider = "anthropic" | "groq";

export interface Credentials {
  provider: Provider;
  model?: string;
  groqKey?: string;
  anthropicKey?: string;
  tavilyKey?: string;
}

const key = z.string().trim().max(300).optional().transform((v) => v || undefined);

/** What the browser may send. All optional: anything missing falls back to the server's .env. */
export const CredentialsInput = z
  .object({
    provider: z.enum(["groq", "anthropic"]).optional(),
    model: z.string().trim().max(100).regex(/^[\w./:-]*$/, "Invalid model name").optional().transform((v) => v || undefined),
    groqKey: key,
    anthropicKey: key,
    tavilyKey: key,
  })
  .strict();
export type CredentialsInput = z.infer<typeof CredentialsInput>;

/** The server's own configuration (.env). */
export function serverCredentials(): Credentials {
  const e = env();
  return {
    provider: e.LLM_PROVIDER,
    model: e.LLM_MODEL,
    groqKey: e.GROQ_API_KEY,
    anthropicKey: e.ANTHROPIC_API_KEY,
    tavilyKey: e.TAVILY_API_KEY,
  };
}

/** Visitor-supplied values win; each missing piece falls back to the server's .env. */
export function resolveCredentials(input?: CredentialsInput): Credentials {
  const server = serverCredentials();
  if (!input) return server;
  const provider = input.provider ?? server.provider;
  return {
    provider,
    // A model chosen for the server's provider doesn't carry over when the visitor switches provider.
    model: input.model ?? (provider === server.provider ? server.model : undefined),
    groqKey: input.groqKey ?? server.groqKey,
    anthropicKey: input.anthropicKey ?? server.anthropicKey,
    tavilyKey: input.tavilyKey ?? server.tavilyKey,
  };
}

/** True when the visitor supplied at least one key (vs. relying entirely on the server's). */
export function hasUserKeys(input?: CredentialsInput): boolean {
  return !!(input?.groqKey || input?.anthropicKey || input?.tavilyKey);
}

// ---------- per-job scope ----------

const store = new AsyncLocalStorage<Credentials>();

export function runWithCredentials<T>(creds: Credentials, fn: () => T): T {
  return store.run(creds, fn);
}

/** Credentials of the job currently running, else the server's. */
export function currentCredentials(): Credentials {
  return store.getStore() ?? serverCredentials();
}

// ---------- hand-off from the API request to the job runner ----------
// Keyed by the job's dedupe key (set before the job row exists, so the runner can never claim the
// job before its keys are available). Entries expire if the job never starts.

const TTL_MS = 30 * 60_000;
const g = globalThis as unknown as { __pendingCredentials?: Map<string, { creds: Credentials; at: number }> };
const pending = (g.__pendingCredentials ??= new Map());

export function stashCredentials(dedupeKey: string, creds: Credentials): void {
  const now = Date.now();
  for (const [k, v] of pending) if (now - v.at > TTL_MS) pending.delete(k);
  pending.set(dedupeKey, { creds, at: now });
}

/** Drop a stash that no job will consume (e.g. the request joined a job that is already running). */
export function discardCredentials(dedupeKey: string): void {
  pending.delete(dedupeKey);
}

export function takeCredentials(dedupeKey: string | null): Credentials | undefined {
  if (!dedupeKey) return undefined;
  const hit = pending.get(dedupeKey);
  pending.delete(dedupeKey);
  return hit && Date.now() - hit.at <= TTL_MS ? hit.creds : undefined;
}
