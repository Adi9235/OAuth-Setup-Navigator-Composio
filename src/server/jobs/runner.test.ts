import { describe, expect, it, vi } from "vitest";
import { ServiceError } from "@/lib/service-error";

vi.mock("@/lib/env", () => ({ env: () => ({ LLM_PROVIDER: "groq", JOB_CONCURRENCY: 1 }) }));
const events: { step: string; level: string; message: string; payload?: Record<string, unknown> }[] = [];
vi.mock("./events", () => ({
  createEmitter: () => async (step: string, level: string, message: string, payload?: Record<string, unknown>) => {
    events.push({ step, level, message, payload });
  },
  emit: vi.fn(),
}));
const finishJob = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
vi.mock("@/lib/db/jobs", () => ({
  claimNextJob: vi.fn(),
  failStaleJobs: vi.fn(async () => []),
  finishJob: (...a: unknown[]) => finishJob(...a),
  getJob: vi.fn(async () => ({ current_step: "research" })),
}));

const { registerHandler, runJob } = await import("./runner");
const job = { id: "job-1", job_type: "generate", input_text: "linkedin" } as never;

describe("runJob failures", () => {
  it("records a plain-language explanation and marks the job failed", async () => {
    registerHandler("generate", async () => {
      throw new ServiceError("llm", "groq", "quota_exhausted", "Groq daily limit reached", 280);
    });
    await runJob(job);
    const err = events.find((e) => e.level === "error")!;
    expect(err.step).toBe("research");
    expect(err.message).toBe("Groq usage limit reached");
    expect(err.payload?.error).toMatchObject({ code: "quota_exhausted", retryAfterSec: 280 });
    expect(finishJob).toHaveBeenCalledWith("job-1", "failed", expect.stringMatching(/^Groq usage limit reached: /));
  });

  it("succeeds with a done event carrying the slug", async () => {
    events.length = 0;
    registerHandler("generate", async () => ({ slug: "linkedin" }));
    await runJob(job);
    expect(events.at(-1)).toMatchObject({ step: "done", level: "success", payload: { slug: "linkedin" } });
    expect(finishJob).toHaveBeenLastCalledWith("job-1", "succeeded");
  });
});
