import { describe, expect, it } from "vitest";
import { explainError, firstFatal, formatWait, isFatal, ServiceError } from "./service-error";
import { settleFailFast } from "./settle";

const llm = (code: ConstructorParameters<typeof ServiceError>[2], provider = "groq", retry?: number) =>
  new ServiceError("llm", provider, code, "x", retry);

describe("isFatal", () => {
  it("treats configuration and quota problems as fatal, one-off failures as not", () => {
    for (const c of ["missing_key", "invalid_key", "quota_exhausted", "no_credit", "rate_limited", "model_not_found", "network", "unavailable"] as const)
      expect(isFatal(llm(c))).toBe(true);
    expect(isFatal(llm("bad_output"))).toBe(false);
    expect(isFatal(llm("rejected"))).toBe(false);
    expect(isFatal(new Error("boom"))).toBe(false);
  });

  it("firstFatal finds a fatal rejection", () => {
    const fatal = llm("quota_exhausted");
    expect(firstFatal([{ status: "rejected", reason: llm("bad_output") }, { status: "rejected", reason: fatal }])).toBe(fatal);
    expect(firstFatal([{ status: "fulfilled", value: 1 }])).toBeUndefined();
  });
});

describe("explainError", () => {
  it("explains a Groq daily limit with the wait time and alternatives", () => {
    const x = explainError(llm("quota_exhausted", "groq", 280));
    expect(x.title).toBe("Groq usage limit reached");
    expect(x.detail).toMatch(/free daily token allowance.*app itself is working/);
    expect(x.hint).toMatch(/Try again in 5 minutes/);
    expect(x.hint).toMatch(/GROQ_API_KEY/);
    expect(x.hint).toMatch(/LLM_PROVIDER=anthropic/);
  });

  it("names the exact key that is missing or rejected", () => {
    expect(explainError(llm("missing_key", "anthropic")).hint).toMatch(/ANTHROPIC_API_KEY/);
    expect(explainError(new ServiceError("search", "tavily", "invalid_key", "x")).title).toBe("Tavily rejected the API key");
  });

  it("explains no Anthropic credit and offers Groq", () => {
    const x = explainError(llm("no_credit", "anthropic"));
    expect(x.title).toMatch(/no credit/);
    expect(x.hint).toMatch(/LLM_PROVIDER=groq/);
  });

  it("falls back to a generic explanation for unknown errors", () => {
    expect(explainError(new Error("db down"))).toMatchObject({ code: "internal", detail: "db down" });
  });

  it("formatWait", () => {
    expect(formatWait(30)).toBe("30 seconds");
    expect(formatWait(281)).toBe("5 minutes");
    expect(formatWait(undefined)).toBe("a few minutes");
  });
});

describe("settleFailFast", () => {
  it("returns settled results when nothing fatal happens", async () => {
    const r = await settleFailFast([async () => 1, async () => { throw llm("bad_output"); }], 2);
    expect(r.map((x) => x.status)).toEqual(["fulfilled", "rejected"]);
  });

  it("stops starting tasks after a fatal error and rethrows it", async () => {
    let started = 0;
    const task = (fail: boolean) => async () => {
      started++;
      if (fail) throw llm("quota_exhausted");
      return 1;
    };
    await expect(settleFailFast([task(true), task(false), task(false), task(false)], 1)).rejects.toMatchObject({ code: "quota_exhausted" });
    expect(started).toBe(1);
  });
});
