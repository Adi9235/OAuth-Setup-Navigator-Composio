import type { Difficulty, Guide } from "../guide-schema";
import type { AppRow } from "./apps";
import { db, many, one, type Queryable } from "./pool";

export type Freshness = "fresh" | "rechecking" | "outdated";

export interface GuideRow {
  id: string;
  app_id: string;
  current_version_id: string | null;
  status: "draft" | "published" | "failed";
  freshness: Freshness;
  last_verified_at: Date | null;
  next_check_at: Date | null;
  check_interval_days: number;
  created_at: Date;
  updated_at: Date;
}

export interface GuideVersionRow {
  id: string;
  guide_id: string;
  version_no: number;
  content: Guide;
  difficulty: Difficulty;
  difficulty_reasons: string[];
  hands_on_minutes_min: number | null;
  hands_on_minutes_max: number | null;
  approval_wait_days_min: number | null;
  approval_wait_days_max: number | null;
  change_summary: string | null;
  created_by: "agent" | "human";
  job_id: string | null;
  created_at: Date;
}

export interface GuideCard {
  slug: string;
  name: string;
  domain: string;
  difficulty: Difficulty;
  oneLiner: string;
  handsOnMinutes: { min: number; max: number };
  approvalWaitDays: { min: number; max: number };
  confidence: Guide["summary"]["confidence"];
  oauthSupported: Guide["app"]["oauthSupported"];
  freshness: Freshness;
  lastVerifiedAt: string | null;
}

export async function listGuideCards(
  filter: { difficulty?: Difficulty; q?: string } = {},
  q: Queryable = db(),
): Promise<GuideCard[]> {
  const rows = await many<{
    slug: string; name: string; primary_domain: string; freshness: Freshness;
    last_verified_at: Date | null; difficulty: Difficulty; content: Guide;
  }>(
    q,
    `SELECT a.slug, a.name, a.primary_domain, g.freshness, g.last_verified_at, v.difficulty, v.content
       FROM guides g JOIN apps a ON a.id = g.app_id JOIN guide_versions v ON v.id = g.current_version_id
      WHERE g.status = 'published'
        AND ($1::text IS NULL OR v.difficulty = $1)
        AND ($2::text IS NULL OR a.name ILIKE '%' || $2 || '%' OR a.primary_domain ILIKE '%' || $2 || '%')
      ORDER BY a.name`,
    [filter.difficulty ?? null, filter.q?.trim() || null],
  );
  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    domain: r.primary_domain,
    difficulty: r.difficulty,
    oneLiner: r.content.summary.oneLiner,
    handsOnMinutes: r.content.summary.handsOnMinutes,
    approvalWaitDays: r.content.summary.approvalWaitDays,
    confidence: r.content.summary.confidence,
    oauthSupported: r.content.app.oauthSupported,
    freshness: r.freshness,
    lastVerifiedAt: r.last_verified_at?.toISOString() ?? null,
  }));
}

export interface GuideDetail {
  app: AppRow;
  guide: GuideRow;
  version: GuideVersionRow;
  versions: { no: number; created_at: string; change_summary: string | null; created_by: string }[];
}

export async function getGuideBySlug(slug: string, q: Queryable = db()): Promise<GuideDetail | null> {
  const row = await one<{ app: AppRow; guide: GuideRow; version: GuideVersionRow }>(
    q,
    `SELECT row_to_json(a) AS app, row_to_json(g) AS guide, row_to_json(v) AS version
       FROM apps a JOIN guides g ON g.app_id = a.id JOIN guide_versions v ON v.id = g.current_version_id
      WHERE a.slug = $1 AND g.status = 'published'`,
    [slug],
  );
  if (!row) return null;
  const versions = await many<{ no: number; created_at: Date; change_summary: string | null; created_by: string }>(
    q,
    "SELECT version_no AS no, created_at, change_summary, created_by FROM guide_versions WHERE guide_id = $1 ORDER BY version_no DESC",
    [row.guide.id],
  );
  return {
    ...row,
    versions: versions.map((v) => ({ ...v, created_at: new Date(v.created_at).toISOString() })),
  };
}

export function getGuideByAppId(appId: string, q: Queryable = db()) {
  return one<GuideRow>(q, "SELECT * FROM guides WHERE app_id = $1", [appId]);
}

export async function getOrCreateGuide(appId: string, q: Queryable = db()): Promise<GuideRow> {
  await q.query("INSERT INTO guides (app_id) VALUES ($1) ON CONFLICT (app_id) DO NOTHING", [appId]);
  return (await getGuideByAppId(appId, q))!;
}

export function getVersion(id: string, q: Queryable = db()) {
  return one<GuideVersionRow>(q, "SELECT * FROM guide_versions WHERE id = $1", [id]);
}

export async function insertGuideVersion(
  input: { guideId: string; content: Guide; changeSummary?: string; createdBy?: "agent" | "human"; jobId?: string | null },
  q: Queryable = db(),
): Promise<GuideVersionRow> {
  const s = input.content.summary;
  return (await one<GuideVersionRow>(
    q,
    `INSERT INTO guide_versions (guide_id, version_no, content, difficulty, difficulty_reasons,
        hands_on_minutes_min, hands_on_minutes_max, approval_wait_days_min, approval_wait_days_max,
        change_summary, created_by, job_id)
     VALUES ($1, (SELECT COALESCE(MAX(version_no), 0) + 1 FROM guide_versions WHERE guide_id = $1),
        $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      input.guideId, JSON.stringify(input.content), s.difficulty, s.difficultyReasons,
      Math.round(s.handsOnMinutes.min), Math.round(s.handsOnMinutes.max),
      Math.round(s.approvalWaitDays.min), Math.round(s.approvalWaitDays.max),
      input.changeSummary ?? null, input.createdBy ?? "agent", input.jobId ?? null,
    ],
  ))!;
}

/** Only used inside the creating transaction, to embed DB claim ids into content. */
export async function setVersionContent(versionId: string, content: Guide, q: Queryable = db()) {
  await q.query("UPDATE guide_versions SET content = $2 WHERE id = $1", [versionId, JSON.stringify(content)]);
}

export async function publishVersion(guideId: string, versionId: string, q: Queryable = db()) {
  await q.query(
    `UPDATE guides SET current_version_id = $2, status = 'published', freshness = 'fresh',
        last_verified_at = now(), next_check_at = now() + make_interval(days => check_interval_days),
        updated_at = now()
      WHERE id = $1`,
    [guideId, versionId],
  );
}

export async function markVerified(guideId: string, freshness: Freshness, q: Queryable = db()) {
  await q.query(
    `UPDATE guides SET freshness = $2, last_verified_at = now(),
        next_check_at = now() + make_interval(days => check_interval_days), updated_at = now()
      WHERE id = $1`,
    [guideId, freshness],
  );
}

export async function setFreshness(guideId: string, freshness: Freshness, q: Queryable = db()) {
  await q.query("UPDATE guides SET freshness = $2, updated_at = now() WHERE id = $1", [guideId, freshness]);
}

export async function insertFeedback(
  input: { versionId: string; claimId?: string | null; kind: string; comment?: string | null },
  q: Queryable = db(),
) {
  await q.query("INSERT INTO feedback (guide_version_id, claim_id, kind, comment) VALUES ($1, $2, $3, $4)", [
    input.versionId, input.claimId ?? null, input.kind, input.comment ?? null,
  ]);
}
