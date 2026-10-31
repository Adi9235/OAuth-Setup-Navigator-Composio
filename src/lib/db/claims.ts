import type { Evidence, Owner } from "../guide-schema";
import { db, many, one, type Queryable } from "./pool";

// claims.section CHECK values. Guide sections map onto these (see ARCHITECTURE notes):
// signals -> approval/requirement/cost, prerequisites -> requirement, gotchas -> blocker.
export type ClaimSection = "summary" | "requirement" | "step" | "blocker" | "timing" | "scope" | "approval" | "cost";
export type ClaimStatus = "active" | "needs_review" | "invalidated";

export interface ClaimRow {
  id: string;
  guide_version_id: string;
  section: ClaimSection;
  position: number;
  text: string;
  owner: Owner | null;
  evidence: Evidence;
  status: ClaimStatus;
  probe_run_id: string | null;
  last_confirmed_at: Date;
}

export async function insertClaim(
  input: {
    versionId: string; section: ClaimSection; position: number; text: string; owner?: Owner | null;
    evidence: Evidence; probeRunId?: string | null;
  },
  q: Queryable = db(),
): Promise<string> {
  const row = await one<{ id: string }>(
    q,
    `INSERT INTO claims (guide_version_id, section, position, text, owner, evidence, probe_run_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [input.versionId, input.section, input.position, input.text, input.owner ?? null, input.evidence, input.probeRunId ?? null],
  );
  return row!.id;
}

export async function insertClaimSource(
  input: { claimId: string; sourceId: string; snapshotId?: string | null; excerpt?: string | null },
  q: Queryable = db(),
) {
  await q.query(
    `INSERT INTO claim_sources (claim_id, source_id, snapshot_id, excerpt) VALUES ($1, $2, $3, $4)
     ON CONFLICT (claim_id, source_id) DO NOTHING`,
    [input.claimId, input.sourceId, input.snapshotId ?? null, input.excerpt?.slice(0, 300) ?? null],
  );
}

export function listClaims(versionId: string, q: Queryable = db()) {
  return many<ClaimRow>(q, "SELECT * FROM claims WHERE guide_version_id = $1 ORDER BY section, position", [versionId]);
}

/** "This page changed -> which claims depend on it?" */
export function claimsForSources(versionId: string, sourceIds: string[], q: Queryable = db()) {
  return many<ClaimRow & { source_id: string; excerpt: string | null }>(
    q,
    `SELECT c.*, cs.source_id, cs.excerpt FROM claims c JOIN claim_sources cs ON cs.claim_id = c.id
      WHERE c.guide_version_id = $1 AND cs.source_id = ANY($2)`,
    [versionId, sourceIds],
  );
}

export async function setClaimStatus(ids: string[], status: ClaimStatus, q: Queryable = db()) {
  if (ids.length) await q.query("UPDATE claims SET status = $2 WHERE id = ANY($1)", [ids, status]);
}

export async function insertVerificationLog(
  input: {
    claimId: string; verifiedBy: "agent" | "human"; method: "doc_review" | "setup_attempt" | "probe" | "provider_contact";
    outcome: "confirmed" | "corrected" | "unverifiable"; originalText?: string | null; correctedText?: string | null; note?: string | null;
  },
  q: Queryable = db(),
) {
  await q.query(
    `INSERT INTO verification_log (claim_id, verified_by, method, outcome, original_text, corrected_text, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [input.claimId, input.verifiedBy, input.method, input.outcome, input.originalText ?? null, input.correctedText ?? null, input.note ?? null],
  );
}
