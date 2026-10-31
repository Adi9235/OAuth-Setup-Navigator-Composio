import { NextResponse } from "next/server";
import { InputBody } from "@/lib/api-types";
import { CredentialsInput, resolveCredentials } from "@/lib/credentials";
import { assertCanGenerate } from "@/server/config-status";
import { errorResponse, HttpError, parseBody } from "@/server/http";
import { clientIp, jobCreationLimiter } from "@/server/rate-limit";
import { startGenerateJob } from "@/server/resolve";

export const dynamic = "force-dynamic";

// Optional `credentials`: keys/provider/model from the visitor's Settings page (never stored).
const Body = InputBody.extend({ credentials: CredentialsInput.optional() });

export async function POST(req: Request) {
  try {
    const { input, credentials } = await parseBody(req, Body);
    const creds = resolveCredentials(credentials);
    assertCanGenerate(creds);
    if (!jobCreationLimiter.check(clientIp(req)))
      throw new HttpError(429, "Too many guide requests — try again in a few minutes");
    const { jobId } = await startGenerateJob(input, creds);
    return NextResponse.json({ jobId });
  } catch (err) {
    return errorResponse(err);
  }
}
