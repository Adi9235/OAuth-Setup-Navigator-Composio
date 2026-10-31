// Timed fake pipeline for exercising the runner + SSE without spending API credits.
// Used for any job whose input starts with "fake:" (see handlers.ts).
import { throwIfAborted, type JobHandler } from "../jobs/runner";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const fakePipeline: JobHandler = async ({ job, emit, signal }) => {
  const name = job.input_text.replace(/^fake:\s*/i, "") || "Example";
  const steps: [string, string, string][] = [
    ["identify", "Identifying the app…", `Found ${name} (fake) ✓`],
    ["research", "Searching developer docs…", "Read 9 pages ✓"],
    ["probe", "Checking OAuth endpoints…", "Authorize endpoint live ✓"],
    ["verify", "Verifying facts against sources…", "27 confirmed, 2 corrected ✓"],
    ["compose", "Writing the guide…", "Draft written ✓"],
  ];
  for (const [step, start, end] of steps) {
    throwIfAborted(signal);
    await emit(step, "info", start);
    await wait(1500);
    await emit(step, "success", end);
  }
  return { message: "Fake job finished ✓", payload: { fake: true } };
};
