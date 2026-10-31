// GET /api/health — DB reachability + which provider/model is configured and which keys are set
// (presence only, never values). Used by Render's health check and by reviewers.
import { NextResponse } from "next/server";
import { db } from "@/lib/db/pool";
import { configStatus } from "@/server/config-status";

export const dynamic = "force-dynamic";

export async function GET() {
  let database: "ok" | "error" = "ok";
  try {
    await db().query("SELECT 1");
  } catch {
    database = "error";
  }
  const status = configStatus();
  return NextResponse.json({ database, ...status }, { status: database === "ok" ? 200 : 503 });
}
