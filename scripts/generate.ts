// Run the agent pipeline without the UI and print a summary.
//   npx tsx scripts/generate.ts "github"
import { loadEnvFile } from "./load-env";
loadEnvFile();

import { getGuideBySlug } from "@/lib/db/guides";
import { getJob, listJobEvents } from "@/lib/db/jobs";
import { db } from "@/lib/db/pool";
import { startGenerateJob } from "@/server/resolve";
import { runJobInProcess } from "./run-job";
import { printGuideSummary } from "./summary";

async function main() {
  const input = process.argv.slice(2).join(" ").trim();
  if (!input) throw new Error('Usage: npx tsx scripts/generate.ts "<app name or url>"');
  const t0 = Date.now();
  const { jobId, created } = await startGenerateJob(input);
  console.log(`${created ? "Started" : "Joined existing"} job ${jobId} for "${input}"`);
  await runJobInProcess(jobId);

  const job = await getJob(jobId);
  console.log(`\nJob ${job?.status} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (job?.status !== "succeeded") {
    process.exitCode = 1;
    return;
  }
  const done = (await listJobEvents(jobId)).find((e) => e.step === "done");
  const slug = done?.payload?.slug as string | undefined;
  const detail = slug ? await getGuideBySlug(slug) : null;
  if (detail) printGuideSummary(detail.version.content, detail.version.version_no);
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db().end());
