// Job progress events. Written to job_events so the live page can replay after refresh.
import type { JobEvent } from "@/lib/api-types";
import { insertJobEvent, setJobStep, type EventLevel, type JobEventRow } from "@/lib/db/jobs";

export type Emit = (step: string, level: EventLevel, message: string, payload?: Record<string, unknown>) => Promise<void>;

export async function emit(
  jobId: string,
  step: string,
  level: EventLevel,
  message: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  await insertJobEvent({ jobId, step, level, message, payload });
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
