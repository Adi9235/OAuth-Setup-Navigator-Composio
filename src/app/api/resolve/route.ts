import { NextResponse } from "next/server";
import { InputBody } from "@/lib/api-types";
import { errorResponse, parseBody } from "@/server/http";
import { resolveInput } from "@/server/resolve";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { input } = await parseBody(req, InputBody);
    return NextResponse.json(await resolveInput(input));
  } catch (err) {
    return errorResponse(err);
  }
}
