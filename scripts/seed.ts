// Generate the seed library via the real agent (SPEC §5). Runs jobs one at a time, in-process.
//   npm run db:seed                      -> generate any missing seed guides
//   npm run db:seed -- --refresh         -> also re-research existing ones (new version)
//   npm run db:seed -- google linkedin   -> only these
import { loadEnvFile } from "./load-env";
loadEnvFile();

import { getGuideBySlug } from "@/lib/db/guides";
import { getJob } from "@/lib/db/jobs";
import { db } from "@/lib/db/pool";
import { resolveInput, startGenerateJob, startGuideJob } from "@/server/resolve";
import { printGuideSummary } from "./summary";
import { runJobInProcess } from "./run-job";

// Chosen to span setup challenges; final difficulty comes from evidence + rules, not this list.
const SEEDS = ["github", "slack", "notion", "google", "linkedin"];

async function main() {
  const args = process.argv.slice(2);
  const refresh = args.includes("--refresh");
  const only = args.filter((a) => !a.startsWith("--"));
  const inputs = only.length ? only : SEEDS;
  const results: { input: string; status: string; slug?: string; seconds: number }[] = [];

  for (const input of inputs) {
    const t0 = Date.now();
    console.log(`\n=== ${input} ===`);
    const r = await resolveInput(input);
    let jobId: string;
    if (r.type === "guide" && !refresh) {
      console.log(`Already in library (/guides/${r.slug}) — skipping (use --refresh to re-research)`);
      results.push({ input, status: "skipped", slug: r.slug, seconds: 0 });
      continue;
    } else if (r.type === "guide") {
      const started = await startGuideJob(r.slug, "full_refresh");
      if (!started) throw new Error(`Could not start refresh for ${r.slug}`);
      jobId = started.jobId;
    } else if (r.type === "job") {
      jobId = r.jobId;
    } else {
      jobId = (await startGenerateJob(input)).jobId;
    }

    await runJobInProcess(jobId);
    const job = await getJob(jobId);
    const app = job?.app_id ? (await db().query<{ slug: string }>("SELECT slug FROM apps WHERE id = $1", [job.app_id])).rows[0] : undefined;
    results.push({ input, status: job?.status ?? "unknown", slug: app?.slug, seconds: Math.round((Date.now() - t0) / 1000) });
    if (job?.status === "succeeded" && app) {
      const detail = await getGuideBySlug(app.slug);
      if (detail) printGuideSummary(detail.version.content, detail.version.version_no);
    }
  }

  console.log("\nSeed results:");
  for (const r of results) console.log(`  ${r.input.padEnd(10)} ${r.status.padEnd(10)} ${r.slug ? `/guides/${r.slug}` : ""} ${r.seconds ? `(${r.seconds}s)` : ""}`);
  if (results.some((r) => r.status === "failed")) process.exitCode = 1;
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db().end());
