import { db, isUniqueViolation, many, one, type Queryable } from "./pool";

export type JobType = "generate" | "recheck" | "full_refresh";
export type JobStatus = "queued" | "running" | "succeeded" | "failed";
export type EventLevel = "info" | "success" | "warn" | "error";

export interface JobRow {
  id: string;
  job_type: JobType;
  app_id: string | null;
  input_text: string;
  normalized_domain: string | null;
  status: JobStatus;
  current_step: string | null;
  trigger: "user" | "cron" | "source_change" | "feedback" | "manual";
  error: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

export interface JobEventRow {
  id: string; // BIGSERIAL comes back as string
  job_id: string;
  step: string;
  level: EventLevel;
  message: string;
  payload: Record<string, unknown> | null;
  created_at: Date;
}

const ACTIVE_INDEX = "uq_jobs_active_per_domain";

export function getJob(id: string, q: Queryable = db()) {
  return one<JobRow>(q, "SELECT * FROM jobs WHERE id = $1", [id]);
}

export function findActiveJob(dedupeKey: string, q: Queryable = db()) {
  return one<JobRow>(q, "SELECT * FROM jobs WHERE normalized_domain = $1 AND status IN ('queued','running')", [dedupeKey]);
}

/** Insert a job, or return the active one for the same key (uq_jobs_active_per_domain). */
export async function createJobOrGetActive(
  input: { jobType: JobType; inputText: string; dedupeKey: string; appId?: string | null; trigger?: JobRow["trigger"] },
  q: Queryable = db(),
): Promise<{ job: JobRow; created: boolean }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const job = await one<JobRow>(
      q,
      `INSERT INTO jobs (job_type, input_text, normalized_domain, app_id, trigger)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (normalized_domain) WHERE status IN ('queued','running') DO NOTHING
       RETURNING *`,
      [input.jobType, input.inputText, input.dedupeKey, input.appId ?? null, input.trigger ?? "user"],
    );
    if (job) return { job, created: true };
    const active = await findActiveJob(input.dedupeKey, q);
    if (active) return { job: active, created: false };
    // The active job finished between our insert and select — try again.
  }
  throw new Error("Could not create or find an active job");
}

/** Atomically claim the oldest queued job (safe with multiple runners). */
export function claimNextJob(q: Queryable = db()) {
  return one<JobRow>(
    q,
    `UPDATE jobs SET status = 'running', started_at = now()
      WHERE id = (SELECT id FROM jobs WHERE status = 'queued' ORDER BY created_at
                  FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING *`,
  );
}

/** Claim one specific queued job (CLI scripts run jobs in-process). */
export function claimJob(id: string, q: Queryable = db()) {
  return one<JobRow>(
    q,
    "UPDATE jobs SET status = 'running', started_at = now() WHERE id = $1 AND status = 'queued' RETURNING *",
    [id],
  );
}

export async function setJobStep(id: string, step: string, q: Queryable = db()) {
  await q.query("UPDATE jobs SET current_step = $2 WHERE id = $1", [id, step]);
}

/**
 * Once research identifies the real domain, move the job's dedupe key to it. If another
 * active job already holds that domain, returns that job so the caller can hand off.
 */
export async function setJobApp(
  id: string,
  input: { appId: string | null; domain: string },
  q: Queryable = db(),
): Promise<{ ok: true } | { ok: false; activeJob: JobRow }> {
  try {
    await q.query("UPDATE jobs SET app_id = $2, normalized_domain = $3 WHERE id = $1", [id, input.appId, input.domain]);
    return { ok: true };
  } catch (err) {
    if (!isUniqueViolation(err, ACTIVE_INDEX)) throw err;
    const activeJob = await findActiveJob(input.domain, q);
    if (!activeJob) throw err;
    return { ok: false, activeJob };
  }
}

export async function finishJob(id: string, status: "succeeded" | "failed", error: string | null = null, q: Queryable = db()) {
  await q.query("UPDATE jobs SET status = $2, error = $3, finished_at = now() WHERE id = $1", [id, status, error]);
}

/** Crash recovery: anything 'running' for > maxMinutes is failed. Returns affected ids. */
export async function failStaleJobs(maxMinutes = 10, q: Queryable = db()): Promise<string[]> {
  const rows = await many<{ id: string }>(
    q,
    `UPDATE jobs SET status = 'failed', error = 'Interrupted (server restarted or job timed out)', finished_at = now()
      WHERE status = 'running' AND started_at < now() - make_interval(mins => $1)
      RETURNING id`,
    [maxMinutes],
  );
  return rows.map((r) => r.id);
}

export function insertJobEvent(
  input: { jobId: string; step: string; level?: EventLevel; message: string; payload?: unknown },
  q: Queryable = db(),
) {
  return one<JobEventRow>(
    q,
    "INSERT INTO job_events (job_id, step, level, message, payload) VALUES ($1, $2, $3, $4, $5) RETURNING *",
    [input.jobId, input.step, input.level ?? "info", input.message, input.payload === undefined ? null : JSON.stringify(input.payload)],
  ) as Promise<JobEventRow>;
}

export function listJobEvents(jobId: string, afterId = "0", q: Queryable = db()) {
  return many<JobEventRow>(q, "SELECT * FROM job_events WHERE job_id = $1 AND id > $2 ORDER BY id", [jobId, afterId]);
}
