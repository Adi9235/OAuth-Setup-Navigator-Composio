import { describe, expect, it } from "vitest";
import { sampleGuide } from "@/test/fixtures";
import { Claim, GuideSchema, Range, Step } from "./guide-schema";

describe("GuideSchema", () => {
  it("accepts a valid sample guide", () => {
    expect(GuideSchema.safeParse(sampleGuide()).success).toBe(true);
  });

  it("defaults missing sources and scopes to []", () => {
    const rest: Partial<ReturnType<typeof sampleGuide>> = sampleGuide();
    delete rest.scopes;
    const parsed = GuideSchema.parse(rest);
    expect(parsed.scopes).toEqual([]);
  });

  it("requires at least one step", () => {
    expect(GuideSchema.safeParse(sampleGuide({ steps: [] })).success).toBe(false);
  });

  it("rejects an unknown signal value", () => {
    const g = sampleGuide();
    const bad = { ...g, signals: { ...g.signals, reviewRequired: { ...g.signals.reviewRequired, value: "sometimes" } } };
    expect(GuideSchema.safeParse(bad).success).toBe(false);
  });

  it("caps oneLiner at 240 chars", () => {
    const g = sampleGuide();
    expect(GuideSchema.safeParse({ ...g, summary: { ...g.summary, oneLiner: "x".repeat(241) } }).success).toBe(false);
  });
});

describe("Claim evidence rules", () => {
  const base = { id: "c1", text: "Some claim" };

  it("sourced needs >=1 source", () => {
    const r = Claim.safeParse({ ...base, evidence: "sourced", sources: [] });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toMatch(/sourced claim needs/);
    expect(Claim.safeParse({ ...base, evidence: "sourced", sources: [{ url: "https://x.example/a" }] }).success).toBe(true);
  });

  it("tested needs probeId", () => {
    expect(Claim.safeParse({ ...base, evidence: "tested" }).success).toBe(false);
    expect(Claim.safeParse({ ...base, evidence: "tested", probeId: "p1" }).success).toBe(true);
  });

  it("uncertain needs uncertaintyNote", () => {
    expect(Claim.safeParse({ ...base, evidence: "uncertain" }).success).toBe(false);
    expect(Claim.safeParse({ ...base, evidence: "uncertain", uncertaintyNote: "Not documented" }).success).toBe(true);
  });

  it("evidence rules also apply to steps (intersection)", () => {
    const step = { ...base, title: "Do it", owner: "you", phase: "create", evidence: "sourced", sources: [] };
    expect(Step.safeParse(step).success).toBe(false);
  });

  it("excerpt is limited to 300 chars", () => {
    const r = Claim.safeParse({ ...base, evidence: "sourced", sources: [{ url: "https://x.example", excerpt: "e".repeat(301) }] });
    expect(r.success).toBe(false);
  });
});

describe("Range", () => {
  it("requires max >= min and non-negative", () => {
    expect(Range.safeParse({ min: 5, max: 2 }).success).toBe(false);
    expect(Range.safeParse({ min: -1, max: 2 }).success).toBe(false);
    expect(Range.safeParse({ min: 0, max: 0 }).success).toBe(true);
  });
});
