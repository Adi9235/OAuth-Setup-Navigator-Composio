// Deterministic difficulty + confidence rules (AGENT_PIPELINE.md). Never chosen by the LLM.
import type { Confidence, Difficulty, Guide, Signals } from "@/lib/guide-schema";
import { SIGNAL_KEYS } from "@/lib/guide-schema";

/** Just the signal values — what the rules read. */
export type SignalValues = { [K in keyof Signals]: Signals[K]["value"] };

export interface DifficultyResult {
  difficulty: Difficulty;
  reasons: string[];
  unclearCount: number;
  forceLowConfidence: boolean;
}

const RANK: Record<Difficulty, number> = { easy: 0, medium: 1, hard: 2 };

export function signalValues(signals: Signals): SignalValues {
  return Object.fromEntries(SIGNAL_KEYS.map((k) => [k, signals[k].value])) as SignalValues;
}

export function computeDifficulty(s: SignalValues): DifficultyResult {
  let level: Difficulty = "easy";
  const reasons: string[] = [];
  const atLeast = (d: Difficulty) => {
    if (RANK[d] > RANK[level]) level = d;
  };
  const anyReview = ["always", "for_public_distribution", "for_sensitive_scopes"].includes(s.reviewRequired);

  if (s.selfServeRegistration === "no" || s.partnerOrApplication === "yes") {
    atLeast("hard");
    reasons.push(
      s.selfServeRegistration === "no"
        ? "R1: No self-serve registration — access must be granted by the provider"
        : "R1: API access requires a partner program or application",
    );
  }
  if (s.securityAssessment === "yes" || s.securityAssessment === "conditional") {
    atLeast("hard");
    reasons.push(
      s.securityAssessment === "yes"
        ? "R2: A third-party security assessment is required"
        : "R2: A security assessment may be required (e.g. for restricted scopes)",
    );
  }
  if (s.paidPlanRequired === "yes") {
    atLeast(anyReview ? "hard" : "medium");
    reasons.push(
      anyReview ? "R3: Paid plan required, plus an app review" : "R3: A paid plan is required",
    );
  }
  if (s.reviewRequired === "always") {
    atLeast("medium");
    reasons.push("R4: Every app must pass a review before use");
  }
  if (s.reviewRequired === "for_sensitive_scopes" || s.reviewRequired === "for_public_distribution") {
    atLeast("medium");
    reasons.push(
      s.reviewRequired === "for_sensitive_scopes"
        ? "R5: Review required for sensitive scopes (testing works without it)"
        : "R5: Review required for public distribution (your own workspace works without it)",
    );
  }
  if (s.businessVerification === "yes") {
    atLeast("medium");
    reasons.push("R6: Business verification is required");
  }
  if (s.partnerOrApplication === "for_some_apis") {
    atLeast("medium");
    reasons.push("R7: Some APIs require a partner program or application");
  }
  if (reasons.length === 0) {
    reasons.push("R8: Self-serve with no review, assessment, or paid plan found");
  }

  const unclearCount = SIGNAL_KEYS.filter((k) => s[k] === "unclear").length;
  const forceLowConfidence = unclearCount >= 3;
  if (forceLowConfidence) reasons.push("R9: Several requirements could not be confirmed");

  return { difficulty: level, reasons, unclearCount, forceLowConfidence };
}

/** Every Claim in a guide (signals, prerequisites, steps, scopes, gotchas). */
export function allClaims(guide: Pick<Guide, "signals" | "prerequisites" | "steps" | "scopes" | "gotchas">) {
  return [
    ...SIGNAL_KEYS.map((k) => guide.signals[k]),
    ...guide.prerequisites,
    ...guide.steps,
    ...guide.scopes,
    ...guide.gotchas,
  ];
}

export function computeConfidence(
  guide: Pick<Guide, "app" | "signals" | "prerequisites" | "steps" | "scopes" | "gotchas">,
): Confidence {
  const claims = allClaims(guide);
  const total = claims.length || 1;
  const uncertain = claims.filter((c) => c.evidence === "uncertain").length;
  const backed = claims.length - uncertain;
  const unclear = SIGNAL_KEYS.filter((k) => guide.signals[k].value === "unclear").length;

  if (uncertain / total > 0.4 || unclear >= 3 || guide.app.oauthSupported !== "yes") return "low";
  if (backed / total >= 0.7 && unclear === 0) return "high";
  return "medium";
}

/** Fill the code-owned summary fields. */
export function applyRules<G extends Omit<Guide, "summary"> & { summary: Omit<Guide["summary"], "difficulty" | "difficultyReasons" | "confidence"> }>(
  guide: G,
): Guide {
  const result = computeDifficulty(signalValues(guide.signals));
  const confidence = result.forceLowConfidence ? "low" : computeConfidence(guide);
  return {
    ...guide,
    summary: {
      ...guide.summary,
      difficulty: result.difficulty,
      difficultyReasons: result.reasons,
      confidence,
    },
  };
}
