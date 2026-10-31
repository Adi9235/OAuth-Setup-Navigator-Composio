// Mark a stuck job as failed (e.g. after a crash).  npx tsx scripts/cancel-job.ts <jobId>
import { loadEnvFile } from "./load-env";
loadEnvFile();

import { finishJob, getJob, insertJobEvent } from "@/lib/db/jobs";
import { db } from "@/lib/db/pool";

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error("Usage: npx tsx scripts/cancel-job.ts <jobId>");
  const job = await getJob(id);
  if (!job) throw new Error("Job not found");
  if (job.status === "succeeded" || job.status === "failed") {
    console.log(`Job already ${job.status}`);
    return;
  }
  await insertJobEvent({ jobId: id, step: job.current_step ?? "error", level: "error", message: "Cancelled by operator" });
  await finishJob(id, "failed", "Cancelled by operator");
  console.log(`Job ${id} marked failed`);
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db().end());
