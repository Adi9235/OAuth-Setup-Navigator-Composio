import { notFound } from "next/navigation";
import { JobEventsFeed } from "@/components/job-events-feed";
import { getJob } from "@/lib/db/jobs";
import { UUID } from "@/server/http";

export const dynamic = "force-dynamic";

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = UUID.test(id) ? await getJob(id) : null;
  if (!job) notFound();
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-6 text-xl font-semibold">Researching {job.input_text}…</h1>
      <JobEventsFeed jobId={job.id} />
    </main>
  );
}
