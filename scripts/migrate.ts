// Applies db/schema.sql to DATABASE_URL. The schema has no IF NOT EXISTS guards, so we
// skip it when the `apps` table already exists (pass --reset to drop and re-apply).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { loadEnvFile } from "./load-env";

async function main() {
  loadEnvFile();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const reset = process.argv.includes("--reset");

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    if (reset) {
      await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
      console.log("Dropped and recreated schema public");
    }
    const { rows } = await client.query<{ exists: boolean }>(
      "SELECT to_regclass('public.apps') IS NOT NULL AS exists",
    );
    if (rows[0]?.exists) {
      console.log("Schema already applied (apps table exists). Use --reset to re-apply.");
      return;
    }
    const sql = readFileSync(join(process.cwd(), "db", "schema.sql"), "utf8");
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log("Applied db/schema.sql");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
