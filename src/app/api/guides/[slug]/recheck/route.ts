import { NextResponse } from "next/server";
import { z } from "zod";
import { CredentialsInput, resolveCredentials } from "@/lib/credentials";
import { assertCanGenerate } from "@/server/config-status";
import { errorResponse, HttpError } from "@/server/http";
import { clientIp, jobCreationLimiter } from "@/server/rate-limit";
import { startGuideJob } from "@/server/resolve";

export const dynamic = "force-dynamic";

const Body = z.object({ credentials: CredentialsInput.optional() });

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    if (!/^[a-z0-9-]{1,80}$/.test(slug)) throw new HttpError(404, "Guide not found");
    // Body is optional (older clients send none).
    const raw = await req.json().catch(() => ({}));
    const parsed = Body.safeParse(raw ?? {});
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid request");
    const creds = resolveCredentials(parsed.data.credentials);
    assertCanGenerate(creds);
    if (!jobCreationLimiter.check(clientIp(req))) throw new HttpError(429, "Too many requests — try again in a few minutes");
    const started = await startGuideJob(slug, "recheck", "manual", creds);
    if (!started) throw new HttpError(404, "Guide not found");
    return NextResponse.json({ jobId: started.jobId });
  } catch (err) {
    return errorResponse(err);
  }
}
