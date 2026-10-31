import { NextResponse } from "next/server";
import { getJob } from "@/lib/db/jobs";
import { errorResponse, HttpError, UUID } from "@/server/http";
import { toJobSummary } from "@/server/resolve";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const job = UUID.test(id) ? await getJob(id) : null;
    if (!job) throw new HttpError(404, "Job not found");
    return NextResponse.json(toJobSummary(job));
  } catch (err) {
    return errorResponse(err);
  }
}
