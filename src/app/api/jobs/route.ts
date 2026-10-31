import { NextResponse } from "next/server";
import { InputBody } from "@/lib/api-types";
import { errorResponse, HttpError, parseBody } from "@/server/http";
import { clientIp, jobCreationLimiter } from "@/server/rate-limit";
import { startGenerateJob } from "@/server/resolve";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { input } = await parseBody(req, InputBody);
    if (!jobCreationLimiter.check(clientIp(req)))
      throw new HttpError(429, "Too many guide requests — try again in a few minutes");
    const { jobId } = await startGenerateJob(input);
    return NextResponse.json({ jobId });
  } catch (err) {
    return errorResponse(err);
  }
}
