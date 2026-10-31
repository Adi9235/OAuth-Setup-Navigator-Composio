import { NextResponse } from "next/server";
import { z } from "zod";
import { listClaims } from "@/lib/db/claims";
import { getGuideBySlug, insertFeedback } from "@/lib/db/guides";
import { errorResponse, HttpError, parseBody, UUID } from "@/server/http";
import { clientIp, createRateLimiter } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

const Body = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,80}$/),
  claimId: z.string().max(80).optional(),
  kind: z.enum(["step_failed", "outdated", "unclear", "helpful", "other"]),
  comment: z.string().trim().max(1000).optional(),
});

const feedbackLimiter = createRateLimiter(30, 10 * 60_000);

export async function POST(req: Request) {
  try {
    const body = await parseBody(req, Body);
    if (!feedbackLimiter.check(clientIp(req))) throw new HttpError(429, "Too many requests");
    const detail = await getGuideBySlug(body.slug);
    if (!detail) throw new HttpError(404, "Guide not found");
    // Only link claims that belong to the current version.
    const claimId = body.claimId && UUID.test(body.claimId)
      ? (await listClaims(detail.version.id)).find((c) => c.id === body.claimId)?.id ?? null
      : null;
    await insertFeedback({ versionId: detail.version.id, claimId, kind: body.kind, comment: body.comment ?? null });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
