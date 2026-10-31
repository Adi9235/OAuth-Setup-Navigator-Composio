// Shapes shared by API route handlers and client components.
import { z } from "zod";
import { MAX_INPUT_LENGTH } from "./normalize";

export const InputBody = z.object({ input: z.string().trim().min(1, "Enter an app name or URL").max(MAX_INPUT_LENGTH) });

export type ResolveResponse = { type: "guide"; slug: string } | { type: "job"; jobId: string } | { type: "new" };

export const JOB_STEPS = ["identify", "research", "probe", "verify", "compose"] as const;
export type JobStep = (typeof JOB_STEPS)[number] | "done" | "recheck";

export interface JobEvent {
  id: string;
  step: string;
  level: "info" | "success" | "warn" | "error";
  message: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface JobSummary {
  id: string;
  jobType: string;
  status: "queued" | "running" | "succeeded" | "failed";
  inputText: string;
  currentStep: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export function isTerminal(status: JobSummary["status"]) {
  return status === "succeeded" || status === "failed";
}
