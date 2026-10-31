// In-process job runner backed by the `jobs` table. Polls every 1s, runs up to
// JOB_CONCURRENCY jobs at once. Callers only insert rows, so this can move to BullMQ later.
import { env } from "@/lib/env";
import { llmProfile } from "@/lib/llm";
import { claimNextJob, failStaleJobs, finishJob, getJob, type JobRow } from "@/lib/db/jobs";
import { explainError, type ErrorExplanation } from "@/lib/service-error";
import { runWithCredentials, serverCredentials, takeCredentials, type Credentials } from "@/lib/credentials";
import { createEmitter, emit, type Emit } from "./events";

/** Hard cap per job: 5 min on Claude; longer on Groq's rate-limited free tier. */
export const jobHardCapMs = () => llmProfile().jobCapMs;
const POLL_MS = 1000;

export interface JobContext {
  job: JobRow;
  emit: Emit;
  signal: AbortSignal;
}
export interface JobResult {
  slug?: string;
  message?: string;
  payload?: Record<string, unknown>;
}
export type JobHandler = (ctx: JobContext) => Promise<JobResult>;

const handlers = new Map<JobRow["job_type"], JobHandler>();

export function registerHandler(type: JobRow["job_type"], handler: JobHandler) {
  handlers.set(type, handler);
}

export class JobAbortedError extends Error {
  constructor() {
    super(`Job exceeded the ${Math.round(jobHardCapMs() / 60_000)} minute limit`);
    this.name = "JobAbortedError";
  }
}

export function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new JobAbortedError();
}

export function explainJobError(err: unknown): ErrorExplanation {
  if (err instanceof JobAbortedError)
    return {
      code: "internal",
      title: "Research took too long and was stopped",
      detail: err.message,
      hint: "Try again. On Groq's free tier, slow jobs usually mean the per-minute rate limit is being hit.",
    };
  return explainError(err);
}

/**
 * Run one job inside its own credentials scope: the keys a visitor entered in Settings when
 * starting it (handed over in memory), else the server's .env keys.
 */
export function runJob(job: JobRow, creds?: Credentials): Promise<void> {
  const scoped = creds ?? takeCredentials(job.normalized_domain) ?? serverCredentials();
  return runWithCredentials(scoped, () => runJobInScope(job));
}

async function runJobInScope(job: JobRow): Promise<void> {
  const emitter = createEmitter(job.id);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), jobHardCapMs());
  try {
    const handler = handlers.get(job.job_type);
    if (!handler) throw new Error(`No handler for job type ${job.job_type}`);
    const result = await Promise.race([
      handler({ job, emit: emitter, signal: controller.signal }),
      new Promise<never>((_, reject) =>
        controller.signal.addEventListener("abort", () => reject(new JobAbortedError()), { once: true }),
      ),
    ]);
    await emitter("done", "success", result.message ?? "Guide ready ✓", {
      ...result.payload,
      ...(result.slug ? { slug: result.slug } : {}),
    });
    await finishJob(job.id, "succeeded");
  } catch (err) {
    const explanation = explainJobError(err);
    console.error(`[jobs] ${job.id} failed: ${explanation.title} — ${explanation.detail}`);
    if (explanation.code === "internal" && err instanceof Error && err.stack) console.error(err.stack);
    const step = (await getJob(job.id).catch(() => null))?.current_step ?? "error";
    // The full explanation travels in the payload so the job page can show what to do next.
    await emitter(step, "error", explanation.title, { error: explanation }).catch(() => {});
    await finishJob(job.id, "failed", `${explanation.title}: ${explanation.detail}`).catch(() => {});
  } finally {
    clearTimeout(timer);
  }
}

interface RunnerState {
  started: boolean;
  active: number;
}
const g = globalThis as unknown as { __jobRunner?: RunnerState };

/** Start the polling loop once per process (guarded against dev hot reload). */
export function startRunner(): void {
  if (g.__jobRunner?.started) return;
  const state: RunnerState = { started: true, active: 0 };
  g.__jobRunner = state;
  const max = env().JOB_CONCURRENCY;

  void (async () => {
    try {
      const stale = await failStaleJobs(Math.ceil(jobHardCapMs() / 60_000) + 5);
      for (const id of stale) await emit(id, "error", "error", "Job was interrupted (server restart). Please retry.");
      if (stale.length) console.log(`[jobs] marked ${stale.length} stale job(s) failed`);
    } catch (err) {
      console.error("[jobs] crash recovery failed:", err instanceof Error ? err.message : err);
    }
  })();

  const tick = async () => {
    try {
      while (state.active < max) {
        const job = await claimNextJob();
        if (!job) break;
        state.active++;
        void runJob(job).finally(() => state.active--);
      }
    } catch (err) {
      console.error("[jobs] poll failed:", err instanceof Error ? err.message : err);
    } finally {
      setTimeout(tick, POLL_MS);
    }
  };
  setTimeout(tick, POLL_MS);
  console.log(`[jobs] runner started (concurrency ${max})`);
}
