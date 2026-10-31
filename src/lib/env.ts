import { z } from "zod";

// Only the vars listed in .env.example. API keys are optional at boot so the UI and library
// work without them; agent code calls requireEnv() and fails the job with a clear message.
const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  LLM_PROVIDER: z.enum(["anthropic", "groq"]).default("groq"),
  ANTHROPIC_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  // Optional: each provider has its own default model (see src/lib/llm.ts).
  LLM_MODEL: z.string().min(1).optional(),
  TAVILY_API_KEY: z.string().optional(),
  JOB_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  USER_AGENT: z
    .string()
    .min(1)
    .default("OAuthSetupNavigator/0.1 (+https://github.com/oauth-setup-navigator)"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const blankToUndefined = Object.fromEntries(
    Object.keys(EnvSchema.shape).map((k) => [k, process.env[k] === "" ? undefined : process.env[k]]),
  );
  const parsed = EnvSchema.safeParse(blankToUndefined);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function requireEnv(key: "ANTHROPIC_API_KEY" | "GROQ_API_KEY" | "TAVILY_API_KEY"): string {
  const value = env()[key];
  if (!value) throw new Error(`${key} is not set. Add it to .env (see .env.example).`);
  return value;
}
