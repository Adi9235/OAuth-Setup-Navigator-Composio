import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { JobProgress } from "@/components/job-progress";
import { getJob, listJobEvents } from "@/lib/db/jobs";
import { UUID } from "@/server/http";
import { toJobSummary } from "@/server/resolve";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Generating guide" };

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = UUID.test(id) ? await getJob(id) : null;
  if (!job) notFound();

  // Finished already (e.g. opened from history): go straight to the guide.
  if (job.status === "succeeded") {
    const done = (await listJobEvents(job.id)).find((e) => e.step === "done");
    const slug = done?.payload?.slug;
    if (typeof slug === "string") redirect(`/guides/${slug}`);
    const follow = done?.payload?.jobId;
    if (typeof follow === "string" && follow !== job.id) redirect(`/jobs/${follow}`);
  }
  return <JobProgress job={toJobSummary(job)} />;
}
