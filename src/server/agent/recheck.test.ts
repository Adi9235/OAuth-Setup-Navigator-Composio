import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ env: () => ({ USER_AGENT: "Test/1.0", LLM_PROVIDER: "anthropic" }), requireEnv: () => "k" }));

const { compactDiff } = await import("./recheck");

describe("compactDiff", () => {
  it("returns only changed paragraphs with +/- markers", () => {
    const before = "Intro paragraph.\n\nReview takes 5 business days.\n\nFooter text.";
    const after = "Intro paragraph.\n\nReview takes 10 business days.\n\nFooter text.";
    const diff = compactDiff(before, after);
    expect(diff).toContain("- Review takes 5 business days.");
    expect(diff).toContain("+ Review takes 10 business days.");
    expect(diff).not.toContain("Intro paragraph");
  });

  it("is empty when only whitespace changed, and caps long diffs", () => {
    expect(compactDiff("A  b\n\nc", "A b\n\n\nc")).toBe("");
    const long = compactDiff("x", "y ".repeat(10_000), 100);
    expect(long.length).toBeLessThan(130);
    expect(long).toMatch(/truncated/);
  });
});
