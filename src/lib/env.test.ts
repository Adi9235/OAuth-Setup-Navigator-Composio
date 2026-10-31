import { afterEach, describe, expect, it, vi } from "vitest";

describe("env", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("applies defaults and treats blank keys as unset", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost:5432/db");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("JOB_CONCURRENCY", "");
    const { env, requireEnv } = await import("./env");
    expect(env().JOB_CONCURRENCY).toBe(2);
    expect(env().ANTHROPIC_API_KEY).toBeUndefined();
    expect(() => requireEnv("ANTHROPIC_API_KEY")).toThrow(/ANTHROPIC_API_KEY is not set/);
  });

  it("rejects an invalid DATABASE_URL", async () => {
    vi.stubEnv("DATABASE_URL", "not a url");
    const { env } = await import("./env");
    expect(() => env()).toThrow(/DATABASE_URL/);
  });
});
