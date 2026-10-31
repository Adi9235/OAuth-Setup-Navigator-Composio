import { slugify } from "../normalize";
import { db, many, one, type Queryable } from "./pool";

export interface AppRow {
  id: string;
  slug: string;
  name: string;
  primary_domain: string;
  aliases: string[];
  category: string | null;
  developer_portal_url: string | null;
  created_at: Date;
}

export function getAppById(id: string, q: Queryable = db()) {
  return one<AppRow>(q, "SELECT * FROM apps WHERE id = $1", [id]);
}

export function findAppByDomain(domain: string, q: Queryable = db()) {
  return one<AppRow>(q, "SELECT * FROM apps WHERE primary_domain = $1 OR $1 = ANY(aliases)", [domain.toLowerCase()]);
}

/** Bare-name lookup: slug, case-insensitive name, or alias. */
export function findAppByName(name: string, q: Queryable = db()) {
  const lower = name.trim().toLowerCase();
  return one<AppRow>(
    q,
    "SELECT * FROM apps WHERE slug = $1 OR lower(name) = $2 OR $2 = ANY(aliases) OR $1 = ANY(aliases) LIMIT 1",
    [slugify(lower), lower],
  );
}

/**
 * Insert an app, deduping slug with -2, -3... If the domain already exists (another job won
 * the race), returns the existing row instead.
 */
export async function insertApp(
  input: { name: string; domain: string; developerPortalUrl?: string; aliases?: string[] },
  q: Queryable = db(),
): Promise<AppRow> {
  const base = slugify(input.name) || slugify(input.domain);
  const aliases = [...new Set((input.aliases ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean))];
  for (let n = 1; n < 50; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const row = await one<AppRow>(
      q,
      `INSERT INTO apps (slug, name, primary_domain, aliases, developer_portal_url)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING *`,
      [slug, input.name, input.domain.toLowerCase(), aliases, input.developerPortalUrl ?? null],
    );
    if (row) return row;
    const existing = await findAppByDomain(input.domain, q);
    if (existing) return existing;
  }
  throw new Error(`Could not allocate a slug for ${input.name}`);
}

export async function addAliases(appId: string, aliases: string[], q: Queryable = db()) {
  const clean = [...new Set(aliases.map((a) => a.trim().toLowerCase()).filter(Boolean))];
  if (!clean.length) return;
  await q.query(
    `UPDATE apps SET aliases = (SELECT array_agg(DISTINCT a) FROM unnest(aliases || $2::text[]) a) WHERE id = $1`,
    [appId, clean],
  );
}

export function listApps(q: Queryable = db()) {
  return many<AppRow>(q, "SELECT * FROM apps ORDER BY name");
}
