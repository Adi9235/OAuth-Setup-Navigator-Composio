import { NextResponse } from "next/server";
import { z } from "zod";
import { listGuideCards } from "@/lib/db/guides";
import { Difficulty } from "@/lib/guide-schema";
import { errorResponse, HttpError } from "@/server/http";

export const dynamic = "force-dynamic";

const Query = z.object({ difficulty: Difficulty.optional(), q: z.string().max(100).optional() });

export async function GET(req: Request) {
  try {
    const params = Object.fromEntries(new URL(req.url).searchParams);
    const parsed = Query.safeParse(params);
    if (!parsed.success) throw new HttpError(400, "difficulty must be easy, medium or hard");
    return NextResponse.json(await listGuideCards(parsed.data));
  } catch (err) {
    return errorResponse(err);
  }
}
