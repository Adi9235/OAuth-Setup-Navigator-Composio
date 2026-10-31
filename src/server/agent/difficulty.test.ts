import { describe, expect, it } from "vitest";
import { sampleGuide, signalsFrom } from "@/test/fixtures";
import { applyRules, computeConfidence, computeDifficulty, signalValues, type SignalValues } from "./difficulty";

const easy: SignalValues = signalValues(signalsFrom());
const run = (v: Partial<SignalValues>) => computeDifficulty({ ...easy, ...v });
const ids = (reasons: string[]) => reasons.map((r) => r.split(":")[0]);

describe("computeDifficulty rules", () => {
  it("R8: nothing fires -> easy", () => {
    const r = run({});
    expect(r.difficulty).toBe("easy");
    expect(ids(r.reasons)).toEqual(["R8"]);
  });

  it("R1: no self-serve -> hard", () => {
    expect(run({ selfServeRegistration: "no" })).toMatchObject({ difficulty: "hard" });
  });

  it("R1: partner application required -> hard", () => {
    const r = run({ partnerOrApplication: "yes" });
    expect(r.difficulty).toBe("hard");
    expect(ids(r.reasons)).toEqual(["R1"]);
  });

  it("R2: security assessment yes or conditional -> hard", () => {
    expect(run({ securityAssessment: "yes" }).difficulty).toBe("hard");
    expect(run({ securityAssessment: "conditional" }).difficulty).toBe("hard");
  });

  it("R3: paid plan alone -> medium; with any review -> hard", () => {
    expect(run({ paidPlanRequired: "yes" }).difficulty).toBe("medium");
    expect(run({ paidPlanRequired: "yes", reviewRequired: "for_public_distribution" }).difficulty).toBe("hard");
    expect(run({ paidPlanRequired: "yes", reviewRequired: "always" }).difficulty).toBe("hard");
    expect(run({ paidPlanRequired: "for_some_features" }).difficulty).toBe("easy");
  });

  it("R4: review always -> medium", () => {
    const r = run({ reviewRequired: "always" });
    expect(r.difficulty).toBe("medium");
    expect(ids(r.reasons)).toEqual(["R4"]);
  });

  it("R5: review for public distribution / sensitive scopes -> medium", () => {
    expect(run({ reviewRequired: "for_public_distribution" }).difficulty).toBe("medium");
    expect(ids(run({ reviewRequired: "for_sensitive_scopes" }).reasons)).toEqual(["R5"]);
  });

  it("R6: business verification yes -> medium (conditional does not fire)", () => {
    expect(run({ businessVerification: "yes" }).difficulty).toBe("medium");
    expect(run({ businessVerification: "conditional" }).difficulty).toBe("easy");
  });

  it("R7: partner for some APIs -> medium", () => {
    expect(run({ partnerOrApplication: "for_some_apis" }).difficulty).toBe("medium");
  });

  it("collects every firing rule as a reason, in order", () => {
    const r = run({ securityAssessment: "conditional", reviewRequired: "for_sensitive_scopes", businessVerification: "yes" });
    expect(r.difficulty).toBe("hard");
    expect(ids(r.reasons)).toEqual(["R2", "R5", "R6"]);
  });

  it("R9: >=3 unclear keeps level but forces low confidence", () => {
    const r = run({ reviewRequired: "unclear", securityAssessment: "unclear", paidPlanRequired: "unclear" });
    expect(r.difficulty).toBe("easy");
    expect(r.forceLowConfidence).toBe(true);
    expect(ids(r.reasons)).toContain("R9");
    expect(run({ reviewRequired: "unclear", paidPlanRequired: "unclear" }).forceLowConfidence).toBe(false);
  });

  it("is reproducible: same signals -> same result", () => {
    const v = { ...easy, reviewRequired: "for_public_distribution" as const };
    expect(computeDifficulty(v)).toEqual(computeDifficulty({ ...v }));
  });
});

describe("computeConfidence", () => {
  it("high when well-evidenced and no unclear signals", () => {
    expect(computeConfidence(sampleGuide())).toBe("high");
  });

  it("low when oauthSupported is not yes", () => {
    const g = sampleGuide();
    expect(computeConfidence({ ...g, app: { ...g.app, oauthSupported: "unclear" } })).toBe("low");
  });

  it("low when >=3 signals unclear", () => {
    const g = sampleGuide({
      signals: signalsFrom({ reviewRequired: "unclear", paidPlanRequired: "unclear", businessVerification: "unclear" }),
    });
    expect(computeConfidence(g)).toBe("low");
  });

  it("medium with 1-2 unclear signals", () => {
    expect(computeConfidence(sampleGuide({ signals: signalsFrom({ reviewRequired: "unclear" }) }))).toBe("medium");
  });

  it("low when >40% of claims are uncertain", () => {
    const u = (id: string) => ({ id, text: "Not documented anywhere", evidence: "uncertain" as const, sources: [], uncertaintyNote: "x" });
    const g = sampleGuide({ gotchas: Array.from({ length: 8 }, (_, i) => u(`g${i}`)) });
    expect(computeConfidence(g)).toBe("low");
  });
});

describe("applyRules", () => {
  it("overwrites difficulty, reasons and confidence from code", () => {
    const g = sampleGuide({ signals: signalsFrom({ reviewRequired: "for_public_distribution" }) });
    const out = applyRules({ ...g, summary: { ...g.summary, difficulty: "hard", difficultyReasons: ["LLM said so"] } });
    expect(out.summary.difficulty).toBe("medium");
    expect(out.summary.difficultyReasons[0]).toMatch(/^R5/);
  });
});
