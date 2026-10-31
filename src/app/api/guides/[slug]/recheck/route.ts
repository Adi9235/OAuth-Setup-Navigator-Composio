import { NextResponse } from "next/server";
import { errorResponse, HttpError } from "@/server/http";
import { clientIp, jobCreationLimiter } from "@/server/rate-limit";
import { assertCanGenerate } from "@/server/config-status";
import { startGuideJob } from "@/server/resolve";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    if (!/^[a-z0-9-]{1,80}$/.test(slug)) throw new HttpError(404, "Guide not found");
    assertCanGenerate();
    if (!jobCreationLimiter.check(clientIp(req))) throw new HttpError(429, "Too many requests — try again in a few minutes");
    const started = await startGuideJob(slug, "recheck");
    if (!started) throw new HttpError(404, "Guide not found");
    return NextResponse.json({ jobId: started.jobId });
  } catch (err) {
    return errorResponse(err);
  }
}
