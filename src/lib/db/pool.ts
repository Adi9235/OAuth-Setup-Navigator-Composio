import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { env } from "../env";

/** Pool or a transaction client — every helper accepts either. */
export type Queryable = Pool | PoolClient;

const globalForPool = globalThis as unknown as { __pgPool?: Pool };

export function db(): Pool {
  // Kept on globalThis so Next.js dev hot reloads don't leak pools.
  globalForPool.__pgPool ??= new Pool({ connectionString: env().DATABASE_URL, max: 10 });
  return globalForPool.__pgPool;
}

export async function withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function one<R extends QueryResultRow>(q: Queryable, text: string, values: unknown[] = []): Promise<R | null> {
  const { rows } = await q.query<R>(text, values);
  return rows[0] ?? null;
}

export async function many<R extends QueryResultRow>(q: Queryable, text: string, values: unknown[] = []): Promise<R[]> {
  const { rows } = await q.query<R>(text, values);
  return rows;
}

/** Postgres unique_violation, optionally on a specific constraint/index. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string };
  return e?.code === "23505" && (!constraint || e.constraint === constraint);
}
