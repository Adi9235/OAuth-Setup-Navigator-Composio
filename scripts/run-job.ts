// Shared by CLI scripts: run a job in-process (or follow it if a server runner took it) and
// print its events to the console.
import type { JobEvent } from "@/lib/api-types";
import { claimJob, getJob, listJobEvents } from "@/lib/db/jobs";
import { onJobEvent, toJobEvent } from "@/server/jobs/events";
import { registerAllHandlers } from "@/server/jobs/handlers";
import { runJob } from "@/server/jobs/runner";

const ICON: Record<JobEvent["level"], string> = { info: "·", success: "✓", warn: "!", error: "✗" };
const started = Date.now();

export function printEvent(ev: JobEvent) {
  const t = ((Date.now() - started) / 1000).toFixed(1).padStart(6);
  console.log(`${t}s ${ICON[ev.level]} [${ev.step}] ${ev.message}`);
}

let registered = false;

export async function runJobInProcess(jobId: string): Promise<void> {
  if (!registered) {
    registerAllHandlers();
    registered = true;
  }
  const job = await claimJob(jobId);
  if (job) {
    const off = onJobEvent((id, ev) => id === jobId && printEvent(ev));
    try {
      await runJob(job);
    } finally {
      off();
    }
    return;
  }
  // Someone else (the dev server's runner) is running it: tail its events instead.
  console.log("(job is being run by another process — following its events)");
  let last = "0";
  for (;;) {
    for (const row of await listJobEvents(jobId, last)) {
      last = String(row.id);
      printEvent(toJobEvent(row));
    }
    const j = await getJob(jobId);
    if (!j || j.status === "succeeded" || j.status === "failed") return;
    await new Promise((r) => setTimeout(r, 1000));
  }
}
