# GUIDE SCHEMA — the contract between agent, DB, and UI

Implement exactly this in `src/lib/guide-schema.ts`. Every LLM output and every stored
`guide_versions.content` must pass `GuideSchema.parse`.

```ts
import { z } from "zod";

export const Evidence = z.enum(["tested", "sourced", "uncertain"]);
export const Owner = z.enum(["agent", "you", "both"]);
export const Difficulty = z.enum(["easy", "medium", "hard"]);

export const SourceRef = z.object({
  url: z.string().url(),
  title: z.string().optional(),
  excerpt: z.string().max(300).optional(), // short supporting excerpt, not a long quote
});

// Every factual statement in a guide is a Claim.
export const Claim = z.object({
  id: z.string(),                 // DB claim id (uuid) once stored; temp id before
  text: z.string().min(3),
  evidence: Evidence,
  sources: z.array(SourceRef).default([]), // required non-empty when evidence = "sourced"
  probeId: z.string().optional(),          // required when evidence = "tested"
  uncertaintyNote: z.string().optional(),  // required when evidence = "uncertain": why
}).superRefine((c, ctx) => {
  if (c.evidence === "sourced" && c.sources.length === 0)
    ctx.addIssue({ code: "custom", message: "sourced claim needs >=1 source" });
  if (c.evidence === "tested" && !c.probeId)
    ctx.addIssue({ code: "custom", message: "tested claim needs probeId" });
  if (c.evidence === "uncertain" && !c.uncertaintyNote)
    ctx.addIssue({ code: "custom", message: "uncertain claim needs uncertaintyNote" });
});

export const Range = z.object({ min: z.number().nonnegative(), max: z.number().nonnegative() })
  .refine(r => r.max >= r.min, "max must be >= min");

export const Step = Claim.and(z.object({
  title: z.string(),             // imperative, e.g. "Create the OAuth app"
  owner: Owner,
  agentCanHelp: z.string().optional(),  // what an agent can do here
  humanMust: z.string().optional(),     // what only the human can do (login, pay, sign, record)
  url: z.string().url().optional(),     // console page to open
  phase: z.enum(["prepare", "create", "configure", "test", "submit_review", "go_live"]),
}));

export const GuideSchema = z.object({
  schemaVersion: z.literal(1),
  app: z.object({
    name: z.string(),
    domain: z.string(),
    developerPortalUrl: z.string().url().optional(),
    oauthSupported: z.enum(["yes", "no", "unclear"]),
    oauthVersion: z.string().optional(),   // "OAuth 2.0", "OAuth 2.0 + OIDC"
  }),
  summary: z.object({
    oneLiner: z.string().max(240),        // "Self-serve in ~15 min; no review for basic scopes."
    difficulty: Difficulty,                // filled by code, not the LLM
    difficultyReasons: z.array(z.string()),// rule ids + human text, filled by code
    handsOnMinutes: Range,
    approvalWaitDays: Range,               // {0,0} if no review
    costNote: z.string().optional(),       // "Free", "Paid plan required", "Security assessment may cost..."
    confidence: z.enum(["high", "medium", "low"]), // computed from evidence mix
  }),
  // Facts the rules engine reads. Each is a Claim so it carries evidence.
  signals: z.object({
    selfServeRegistration: Claim.and(z.object({ value: z.enum(["yes","no","unclear"]) })),
    reviewRequired: Claim.and(z.object({
      value: z.enum(["none","for_public_distribution","for_sensitive_scopes","always","unclear"]) })),
    securityAssessment: Claim.and(z.object({ value: z.enum(["no","conditional","yes","unclear"]) })),
    partnerOrApplication: Claim.and(z.object({ value: z.enum(["no","for_some_apis","yes","unclear"]) })),
    paidPlanRequired: Claim.and(z.object({ value: z.enum(["no","for_some_features","yes","unclear"]) })),
    businessVerification: Claim.and(z.object({ value: z.enum(["no","conditional","yes","unclear"]) })),
    domainOrPrivacyPolicy: Claim.and(z.object({ value: z.enum(["no","for_review","yes","unclear"]) })),
  }),
  prerequisites: z.array(Claim),     // things to have before starting
  steps: z.array(Step).min(1),
  scopes: z.array(Claim.and(z.object({
    scope: z.string(), tier: z.enum(["basic","sensitive","restricted","unknown"]) }))).default([]),
  gotchas: z.array(Claim),           // redirect URI rules, token expiry, test-user limits...
  blockers: z.array(z.object({
    problem: z.string(), fix: z.string(), evidence: Evidence, sources: z.array(SourceRef).default([]) })),
  agentVsHuman: z.object({
    agentCan: z.array(z.string()),   // "Draft scope justifications", "Generate privacy policy draft"
    youMust: z.array(z.string()),    // "Sign in to the console", "Accept developer terms", "Record demo video"
  }),
  nextAction: z.string(),            // the single first thing to do right now
  sources: z.array(SourceRef.and(z.object({ fetchedAt: z.string(), official: z.boolean() }))),
  probes: z.array(z.object({
    id: z.string(), type: z.string(), url: z.string(), outcome: z.string(), summary: z.string() })),
  openQuestions: z.array(z.string()),// what the agent could not determine
  generatedAt: z.string(),
});
export type Guide = z.infer<typeof GuideSchema>;
```

## Confidence (computed in code)
- `high`: ≥70% of claims `tested`/`sourced` AND all 7 signals not `unclear`
- `low`: >40% `uncertain` OR ≥3 signals `unclear` OR `oauthSupported !== "yes"`
- otherwise `medium`

## Example (shape only — values must come from real research)
```json
{
  "summary": {
    "oneLiner": "Create an app in minutes; distributing it publicly adds a review step.",
    "difficulty": "medium",
    "difficultyReasons": ["R3: review required for public distribution"],
    "handsOnMinutes": { "min": 30, "max": 90 },
    "approvalWaitDays": { "min": 0, "max": 14 },
    "confidence": "medium"
  }
}
```
