// Tolerate common copy-paste mistakes in DATABASE_URL (dashboards, .env files):
// surrounding quotes, a leading "DATABASE_URL=", or Neon's "psql '...'" snippet.
// Anything else that isn't a Postgres URL fails with a clear message (never echoing the value).

export function normalizeDatabaseUrl(raw: string | undefined): string {
  let v = (raw ?? "").trim();
  v = v.replace(/^DATABASE_URL\s*=\s*/i, "").trim();
  v = v.replace(/^psql\s+/i, "").trim();
  for (let i = 0; i < 2; i++) v = v.replace(/^(['"`])([\s\S]*)\1$/, "$2").trim();
  if (!v) throw new Error("DATABASE_URL is not set");
  if (!/^postgres(ql)?:\/\/[^/\s]+/i.test(v))
    throw new Error(
      "DATABASE_URL must start with postgresql:// (or postgres://). Paste only the connection string — no quotes, no 'psql', no spaces.",
    );
  return v;
}
