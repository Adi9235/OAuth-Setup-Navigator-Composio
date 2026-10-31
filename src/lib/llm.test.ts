import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { callJson, extractJson, LlmError, type CompleteFn } from "./llm";

vi.mock("./env", () => ({ env: () => ({ LLM_PROVIDER: "groq" }) }));

const Schema = z.object({ verdict: z.enum(["supported", "unsupported"]), reason: z.string() });

describe("extractJson", () => {
  it("parses bare, fenced, and prose-wrapped JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJson('Here you go: {"a":3} done')).toEqual({ a: 3 });
  });

  it("throws when there is no object", () => {
    expect(() => extractJson("nope")).toThrow(SyntaxError);
  });
});

describe("callJson", () => {
  it("returns validated data on first success", async () => {
    const complete = vi.fn<CompleteFn>().mockResolvedValue('{"verdict":"supported","reason":"ok"}');
    await expect(callJson("p", Schema, {}, complete)).resolves.toEqual({ verdict: "supported", reason: "ok" });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("retries once with validation errors appended", async () => {
    const complete = vi
      .fn<CompleteFn>()
      .mockResolvedValueOnce('{"verdict":"maybe","reason":"x"}')
      .mockResolvedValueOnce('{"verdict":"unsupported","reason":"y"}');
    await expect(callJson("PROMPT", Schema, {}, complete)).resolves.toMatchObject({ verdict: "unsupported" });
    expect(complete).toHaveBeenCalledTimes(2);
    const retryPrompt = complete.mock.calls[1][0];
    expect(retryPrompt).toContain("PROMPT");
    expect(retryPrompt).toContain("verdict");
  });

  it("fails with LlmError after the retry also fails", async () => {
    const complete = vi.fn<CompleteFn>().mockResolvedValue("not json");
    await expect(callJson("p", Schema, { label: "verify" }, complete)).rejects.toBeInstanceOf(LlmError);
    expect(complete).toHaveBeenCalledTimes(2);
  });
});
