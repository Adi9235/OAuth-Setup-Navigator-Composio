// The guide contract between agent, DB and UI — implemented exactly per docs/GUIDE_SCHEMA.md.
// Every LLM output and every stored guide_versions.content must pass GuideSchema.parse.
import { z } from "zod";

export const Evidence = z.enum(["tested", "sourced", "uncertain"]);
export const Owner = z.enum(["agent", "you", "both"]);
export const Difficulty = z.enum(["easy", "medium", "hard"]);
export type Evidence = z.infer<typeof Evidence>;
export type Owner = z.infer<typeof Owner>;
export type Difficulty = z.infer<typeof Difficulty>;

export const SourceRef = z.object({
  url: z.string().url(),
  title: z.string().optional(),
  excerpt: z.string().max(300).optional(), // short supporting excerpt, not a long quote
});
export type SourceRef = z.infer<typeof SourceRef>;

// Every factual statement in a guide is a Claim.
export const Claim = z
  .object({
    id: z.string(), // DB claim id (uuid) once stored; temp id before
    text: z.string().min(3),
    evidence: Evidence,
    sources: z.array(SourceRef).default([]), // required non-empty when evidence = "sourced"
    probeId: z.string().optional(), // required when evidence = "tested"
    uncertaintyNote: z.string().optional(), // required when evidence = "uncertain": why
  })
  .superRefine((c, ctx) => {
    if (c.evidence === "sourced" && c.sources.length === 0)
      ctx.addIssue({ code: "custom", message: "sourced claim needs >=1 source" });
    if (c.evidence === "tested" && !c.probeId)
      ctx.addIssue({ code: "custom", message: "tested claim needs probeId" });
    if (c.evidence === "uncertain" && !c.uncertaintyNote)
      ctx.addIssue({ code: "custom", message: "uncertain claim needs uncertaintyNote" });
  });
export type Claim = z.infer<typeof Claim>;

export const Range = z
  .object({ min: z.number().nonnegative(), max: z.number().nonnegative() })
  .refine((r) => r.max >= r.min, "max must be >= min");
export type Range = z.infer<typeof Range>;

export const Phase = z.enum(["prepare", "create", "configure", "test", "submit_review", "go_live"]);
export type Phase = z.infer<typeof Phase>;

export const Step = Claim.and(
  z.object({
    title: z.string(), // imperative, e.g. "Create the OAuth app"
    owner: Owner,
    agentCanHelp: z.string().optional(), // what an agent can do here
    humanMust: z.string().optional(), // what only the human can do (login, pay, sign, record)
    url: z.string().url().optional(), // console page to open
    phase: Phase,
  }),
);
export type Step = z.infer<typeof Step>;

const signal = <T extends [string, ...string[]]>(values: T) =>
  Claim.and(z.object({ value: z.enum(values) }));

export const Signals = z.object({
  selfServeRegistration: signal(["yes", "no", "unclear"]),
  reviewRequired: signal(["none", "for_public_distribution", "for_sensitive_scopes", "always", "unclear"]),
  securityAssessment: signal(["no", "conditional", "yes", "unclear"]),
  partnerOrApplication: signal(["no", "for_some_apis", "yes", "unclear"]),
  paidPlanRequired: signal(["no", "for_some_features", "yes", "unclear"]),
  businessVerification: signal(["no", "conditional", "yes", "unclear"]),
  domainOrPrivacyPolicy: signal(["no", "for_review", "yes", "unclear"]),
});
export type Signals = z.infer<typeof Signals>;
export type SignalKey = keyof Signals;
export const SIGNAL_KEYS = Object.keys(Signals.shape) as SignalKey[];

export const ScopeClaim = Claim.and(
  z.object({ scope: z.string(), tier: z.enum(["basic", "sensitive", "restricted", "unknown"]) }),
);
export type ScopeClaim = z.infer<typeof ScopeClaim>;

export const Blocker = z.object({
  problem: z.string(),
  fix: z.string(),
  evidence: Evidence,
  sources: z.array(SourceRef).default([]),
});
export type Blocker = z.infer<typeof Blocker>;

export const GuideSource = SourceRef.and(z.object({ fetchedAt: z.string(), official: z.boolean() }));
export type GuideSource = z.infer<typeof GuideSource>;

export const ProbeSummary = z.object({
  id: z.string(),
  type: z.string(),
  url: z.string(),
  outcome: z.string(),
  summary: z.string(),
});
export type ProbeSummary = z.infer<typeof ProbeSummary>;

export const GuideSchema = z.object({
  schemaVersion: z.literal(1),
  app: z.object({
    name: z.string(),
    domain: z.string(),
    developerPortalUrl: z.string().url().optional(),
    oauthSupported: z.enum(["yes", "no", "unclear"]),
    oauthVersion: z.string().optional(), // "OAuth 2.0", "OAuth 2.0 + OIDC"
  }),
  summary: z.object({
    oneLiner: z.string().max(240),
    difficulty: Difficulty, // filled by code, not the LLM
    difficultyReasons: z.array(z.string()), // rule ids + human text, filled by code
    handsOnMinutes: Range,
    approvalWaitDays: Range, // {0,0} if no review
    costNote: z.string().optional(),
    confidence: z.enum(["high", "medium", "low"]), // computed from evidence mix
  }),
  // Facts the rules engine reads. Each is a Claim so it carries evidence.
  signals: Signals,
  prerequisites: z.array(Claim),
  steps: z.array(Step).min(1),
  scopes: z.array(ScopeClaim).default([]),
  gotchas: z.array(Claim),
  blockers: z.array(Blocker),
  agentVsHuman: z.object({
    agentCan: z.array(z.string()),
    youMust: z.array(z.string()),
  }),
  nextAction: z.string(),
  sources: z.array(GuideSource),
  probes: z.array(ProbeSummary),
  openQuestions: z.array(z.string()),
  generatedAt: z.string(),
});
export type Guide = z.infer<typeof GuideSchema>;
export type Confidence = Guide["summary"]["confidence"];
