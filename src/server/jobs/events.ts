// Job progress events. Written to job_events so the live page can replay after refresh.
import type { JobEvent } from "@/lib/api-types";
import { insertJobEvent, setJobStep, type EventLevel, type JobEventRow } from "@/lib/db/jobs";

export type Emit = (step: string, level: EventLevel, message: string, payload?: Record<string, unknown>) => Promise<void>;

type Listener = (jobId: string, ev: JobEvent) => void;
const listeners = new Set<Listener>();

/** In-process observers (used by the CLI scripts to print progress). */
export function onJobEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function emit(
  jobId: string,
  step: string,
  level: EventLevel,
  message: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  const row = await insertJobEvent({ jobId, step, level, message, payload });
  if (listeners.size) for (const fn of listeners) fn(jobId, toJobEvent(row));
}

/** Bound emitter that also keeps jobs.current_step in sync. */
export function createEmitter(jobId: string): Emit {
  let lastStep: string | null = null;
  return async (step, level, message, payload) => {
    if (step !== lastStep && step !== "done") {
      lastStep = step;
      await setJobStep(jobId, step);
    }
    await emit(jobId, step, level, message, payload);
  };
}

export function toJobEvent(row: JobEventRow): JobEvent {
  return {
    id: String(row.id),
    step: row.step,
    level: row.level,
    message: row.message,
    payload: row.payload,
    createdAt: new Date(row.created_at).toISOString(),
  };
}
