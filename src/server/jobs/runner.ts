// In-process job runner backed by the `jobs` table. Polls every 1s, runs up to
// JOB_CONCURRENCY jobs at once. Callers only insert rows, so this can move to BullMQ later.
import { env } from "@/lib/env";
import { claimNextJob, failStaleJobs, finishJob, getJob, type JobRow } from "@/lib/db/jobs";
import { createEmitter, emit, type Emit } from "./events";

export const JOB_HARD_CAP_MS = 5 * 60_000;
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
    super("Job exceeded the 5 minute limit");
    this.name = "JobAbortedError";
  }
}

export function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new JobAbortedError();
}

export async function runJob(job: JobRow): Promise<void> {
  const emitter = createEmitter(job.id);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JOB_HARD_CAP_MS);
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
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[jobs] ${job.id} failed:`, message);
    const step = (await getJob(job.id).catch(() => null))?.current_step ?? "error";
    await emitter(step, "error", message).catch(() => {});
    await finishJob(job.id, "failed", message).catch(() => {});
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
      const stale = await failStaleJobs(10);
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
