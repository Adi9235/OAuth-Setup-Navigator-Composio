// Small helpers for route handlers: Zod-validated JSON bodies and consistent errors.
import { NextResponse } from "next/server";
import type { z } from "zod";
import { InvalidInputError } from "./resolve";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function parseBody<S extends z.ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new HttpError(400, "Body must be JSON");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid request");
  return parsed.data;
}

export function errorResponse(err: unknown) {
  if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof InvalidInputError) return NextResponse.json({ error: err.message }, { status: 400 });
  console.error("[api]", err instanceof Error ? err.message : err);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
