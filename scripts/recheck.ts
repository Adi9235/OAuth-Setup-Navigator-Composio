// Re-check a guide from the CLI (same job as the "Re-check" button).
//   npx tsx scripts/recheck.ts github
import { loadEnvFile } from "./load-env";
loadEnvFile();

import { getGuideBySlug } from "@/lib/db/guides";
import { getJob } from "@/lib/db/jobs";
import { db } from "@/lib/db/pool";
import { startGuideJob } from "@/server/resolve";
import { runJobInProcess } from "./run-job";

async function main() {
  const slug = process.argv[2];
  if (!slug) throw new Error("Usage: npx tsx scripts/recheck.ts <slug>");
  const before = await getGuideBySlug(slug);
  if (!before) throw new Error(`No published guide for "${slug}"`);
  const started = await startGuideJob(slug, "recheck", "manual");
  if (!started) throw new Error("Could not start re-check");
  await runJobInProcess(started.jobId);
  const job = await getJob(started.jobId);
  const after = await getGuideBySlug(slug);
  console.log(`\nJob ${job?.status}. Version before: v${before.version.version_no} · after: v${after?.version.version_no} · freshness: ${after?.guide.freshness}`);
  if (job?.status !== "succeeded") process.exitCode = 1;
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db().end());
