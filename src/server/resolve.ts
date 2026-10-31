// Library lookup + job creation shared by /api/resolve and /api/jobs.
import type { JobSummary, ResolveResponse } from "@/lib/api-types";
import { findAppByDomain, findAppByName, type AppRow } from "@/lib/db/apps";
import { getGuideByAppId } from "@/lib/db/guides";
import { createJobOrGetActive, findActiveJob, type JobRow } from "@/lib/db/jobs";
import { jobDedupeKey, normalizeInput, type NormalizedInput } from "@/lib/normalize";

export class InvalidInputError extends Error {
  constructor() {
    super("Enter an app name or URL");
  }
}

function parse(input: string): NormalizedInput {
  const n = normalizeInput(input);
  if (!n) throw new InvalidInputError();
  return n;
}

async function findApp(n: NormalizedInput): Promise<AppRow | null> {
  return n.kind === "domain" ? findAppByDomain(n.domain) : findAppByName(n.name);
}

export async function resolveInput(input: string): Promise<ResolveResponse> {
  const n = parse(input);
  const app = await findApp(n);
  if (app) {
    const guide = await getGuideByAppId(app.id);
    if (guide?.status === "published" && guide.current_version_id) return { type: "guide", slug: app.slug };
    const active = await findActiveJob(app.primary_domain);
    if (active) return { type: "job", jobId: active.id };
  }
  const active = await findActiveJob(jobDedupeKey(n));
  if (active) return { type: "job", jobId: active.id };
  return { type: "new" };
}

/** Starts a generate job, or returns the active one for the same app/domain/name. */
export async function startGenerateJob(input: string): Promise<{ jobId: string; created: boolean }> {
  const n = parse(input);
  const app = await findApp(n);
  const dedupeKey = app ? app.primary_domain : jobDedupeKey(n);
  const { job, created } = await createJobOrGetActive({
    jobType: "generate",
    inputText: n.raw,
    dedupeKey,
    appId: app?.id ?? null,
  });
  return { jobId: job.id, created };
}

export function toJobSummary(job: JobRow): JobSummary {
  const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
  return {
    id: job.id,
    jobType: job.job_type,
    status: job.status,
    inputText: job.input_text,
    currentStep: job.current_step,
    error: job.error,
    createdAt: new Date(job.created_at).toISOString(),
    startedAt: iso(job.started_at),
    finishedAt: iso(job.finished_at),
  };
}
