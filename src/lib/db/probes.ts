import { db, many, one, type Queryable } from "./pool";

export type ProbeType =
  | "oidc_discovery" | "oauth_metadata" | "authorize_endpoint" | "token_endpoint" | "developer_console" | "docs_page";
export type ProbeOutcome = "pass" | "fail" | "changed" | "error";

export interface ProbeRunRow {
  id: string;
  app_id: string;
  probe_type: ProbeType;
  target_url: string;
  outcome: ProbeOutcome;
  http_status: number | null;
  result: Record<string, unknown> | null;
  ran_at: Date;
}

export function insertProbeRun(
  input: { appId: string; probeType: ProbeType; targetUrl: string; outcome: ProbeOutcome; httpStatus?: number | null; result?: unknown },
  q: Queryable = db(),
) {
  return one<ProbeRunRow>(
    q,
    `INSERT INTO probe_runs (app_id, probe_type, target_url, outcome, http_status, result)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [input.appId, input.probeType, input.targetUrl, input.outcome, input.httpStatus ?? null,
     input.result === undefined ? null : JSON.stringify(input.result)],
  ) as Promise<ProbeRunRow>;
}

export function getProbeRuns(ids: string[], q: Queryable = db()) {
  return many<ProbeRunRow>(q, "SELECT * FROM probe_runs WHERE id = ANY($1)", [ids]);
}
