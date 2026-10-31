import type { AppRow } from "@/lib/db/apps";
import type { ProbeOutcome, ProbeType } from "@/lib/db/probes";
import type { PageFetcher } from "@/lib/fetch-page";
import type { Emit } from "../jobs/events";

export const FACT_FIELDS = [
  "self_serve_registration", "review_required", "review_time", "security_assessment",
  "partner_or_application", "paid_plan_required", "business_verification", "domain_or_privacy_policy",
  "redirect_uri_rules", "scope", "test_mode_limits", "token_lifetime", "console_url", "setup_step",
  "common_rejection_reason", "other_gotcha",
] as const;
export type FactField = (typeof FACT_FIELDS)[number];

/** Fields that drive difficulty/timing — kept as "uncertain" rather than dropped when unverified. */
export const IMPORTANT_FIELDS: ReadonlySet<FactField> = new Set([
  "review_required", "review_time", "security_assessment", "partner_or_application",
  "paid_plan_required", "business_verification",
]);

export interface IdentifiedApp {
  name: string;
  domain: string;
  developerPortalUrl?: string;
  confidence: "high" | "medium" | "low";
  alternatives: string[];
}

export interface ResearchedPage {
  url: string;
  finalUrl: string;
  title?: string;
  text: string;
  hash: string;
  fetchedAt: string;
  official: boolean;
  sourceId: string;
  snapshotId: string;
}

export interface CandidateFact {
  id: string; // F1, F2... stable within a job
  field: FactField;
  text: string;
  excerpt: string;
  url: string;
  scope?: string;
  tier?: "basic" | "sensitive" | "restricted";
}

export interface VerifiedFact extends CandidateFact {
  evidence: "sourced" | "uncertain";
  verdict: "supported" | "partially" | "unsupported";
  reason: string;
  originalText?: string; // set when verify corrected the text
  uncertaintyNote?: string;
  official: boolean;
}

export interface ProbeFact {
  id: string; // P1, P2...
  runId: string; // probe_runs.id
  type: ProbeType;
  url: string;
  outcome: ProbeOutcome;
  httpStatus: number | null;
  summary: string;
}

export interface AgentContext {
  jobId: string;
  app: AppRow;
  emit: Emit;
  signal: AbortSignal;
  fetcher: PageFetcher;
  /** Every URL the agent saw (search results, fetched pages, probe targets). */
  knownUrls: Set<string>;
}
