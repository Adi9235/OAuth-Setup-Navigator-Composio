import { db, many, one, type Queryable } from "./pool";

export type SourceType = "official_docs" | "changelog" | "policy" | "community" | "other";

export interface SourceRow {
  id: string;
  url: string;
  domain: string;
  title: string | null;
  source_type: SourceType;
  is_official: boolean;
  current_hash: string | null;
  latest_snapshot_id: string | null;
  http_status: number | null;
  fetch_error: string | null;
  last_fetched_at: Date | null;
  last_changed_at: Date | null;
}

export interface SnapshotRow {
  id: string;
  source_id: string;
  content_hash: string;
  content_text: string;
  fetched_at: Date;
}

export function upsertSource(
  input: {
    url: string; domain: string; title?: string | null; sourceType?: SourceType; isOfficial: boolean;
    httpStatus?: number | null; fetchError?: string | null;
  },
  q: Queryable = db(),
) {
  return one<SourceRow>(
    q,
    `INSERT INTO sources (url, domain, title, source_type, is_official, http_status, fetch_error, last_fetched_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (url) DO UPDATE SET
       title = COALESCE(EXCLUDED.title, sources.title), source_type = EXCLUDED.source_type,
       is_official = EXCLUDED.is_official, http_status = EXCLUDED.http_status,
       fetch_error = EXCLUDED.fetch_error, last_fetched_at = now()
     RETURNING *`,
    [input.url, input.domain, input.title ?? null, input.sourceType ?? (input.isOfficial ? "official_docs" : "community"),
     input.isOfficial, input.httpStatus ?? null, input.fetchError ?? null],
  ) as Promise<SourceRow>;
}

/**
 * Store a snapshot only when content changed (UNIQUE source_id+hash) and point the source
 * at it. Returns whether the hash differs from the previous current_hash.
 */
export async function recordSnapshot(
  sourceId: string,
  hash: string,
  text: string,
  q: Queryable = db(),
): Promise<{ snapshotId: string; changed: boolean; previousSnapshotId: string | null }> {
  const prev = await one<{ current_hash: string | null; latest_snapshot_id: string | null }>(
    q, "SELECT current_hash, latest_snapshot_id FROM sources WHERE id = $1", [sourceId],
  );
  await q.query(
    "INSERT INTO source_snapshots (source_id, content_hash, content_text) VALUES ($1, $2, $3) ON CONFLICT (source_id, content_hash) DO NOTHING",
    [sourceId, hash, text],
  );
  const snap = (await one<{ id: string }>(
    q, "SELECT id FROM source_snapshots WHERE source_id = $1 AND content_hash = $2", [sourceId, hash],
  ))!;
  const changed = prev?.current_hash != null && prev.current_hash !== hash;
  await q.query(
    `UPDATE sources SET current_hash = $2, latest_snapshot_id = $3, last_fetched_at = now(),
        last_changed_at = CASE WHEN current_hash IS DISTINCT FROM $2 THEN now() ELSE last_changed_at END
      WHERE id = $1`,
    [sourceId, hash, snap.id],
  );
  return { snapshotId: snap.id, changed, previousSnapshotId: prev?.latest_snapshot_id ?? null };
}

export function getSourcesByUrls(urls: string[], q: Queryable = db()) {
  return many<SourceRow>(q, "SELECT * FROM sources WHERE url = ANY($1)", [urls]);
}

export function getSnapshot(id: string, q: Queryable = db()) {
  return one<SnapshotRow>(q, "SELECT * FROM source_snapshots WHERE id = $1", [id]);
}

export async function markSourceFetchError(sourceId: string, status: number | null, error: string, q: Queryable = db()) {
  await q.query("UPDATE sources SET http_status = $2, fetch_error = $3, last_fetched_at = now() WHERE id = $1", [sourceId, status, error]);
}

export function insertChangeEvent(
  input: {
    sourceId: string; oldSnapshotId: string | null; newSnapshotId: string; diffSummary?: string;
    impact: "unknown" | "none" | "minor" | "breaking"; affectedClaimIds: string[]; resultingVersionId?: string | null;
  },
  q: Queryable = db(),
) {
  return one<{ id: string }>(
    q,
    `INSERT INTO change_events (source_id, old_snapshot_id, new_snapshot_id, diff_summary, impact, affected_claim_ids, resulting_version_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [input.sourceId, input.oldSnapshotId, input.newSnapshotId, input.diffSummary ?? null, input.impact,
     input.affectedClaimIds, input.resultingVersionId ?? null],
  );
}

export async function setChangeEventVersion(ids: string[], versionId: string, q: Queryable = db()) {
  if (ids.length) await q.query("UPDATE change_events SET resulting_version_id = $2 WHERE id = ANY($1)", [ids, versionId]);
}
