import { afterEach, describe, expect, it, vi } from "vitest";

const serverEnv = {
  LLM_PROVIDER: "groq",
  LLM_MODEL: undefined as string | undefined,
  GROQ_API_KEY: "server-groq",
  ANTHROPIC_API_KEY: undefined as string | undefined,
  TAVILY_API_KEY: "server-tavily",
};
vi.mock("./env", () => ({ env: () => serverEnv }));

const {
  CredentialsInput, currentCredentials, discardCredentials, resolveCredentials, runWithCredentials, stashCredentials, takeCredentials,
} = await import("./credentials");
const { createLimiter } = await import("./limit");
const { groqComplete } = await import("./llm-providers");
const { configStatus, assertCanGenerate } = await import("@/server/config-status");

afterEach(() => vi.unstubAllGlobals());

describe("resolveCredentials", () => {
  it("falls back to the server's keys when the visitor sends nothing", () => {
    expect(resolveCredentials()).toMatchObject({ provider: "groq", groqKey: "server-groq", tavilyKey: "server-tavily" });
  });

  it("visitor values win, missing ones fall back", () => {
    const c = resolveCredentials(CredentialsInput.parse({ provider: "anthropic", anthropicKey: "user-ant", model: "claude-opus-5-5" }));
    expect(c).toEqual({ provider: "anthropic", model: "claude-opus-5-5", groqKey: "server-groq", anthropicKey: "user-ant", tavilyKey: "server-tavily" });
  });

  it("treats blank strings as not provided", () => {
    const c = resolveCredentials(CredentialsInput.parse({ groqKey: "  ", tavilyKey: "" }));
    expect(c.groqKey).toBe("server-groq");
    expect(c.tavilyKey).toBe("server-tavily");
  });

  it("rejects unknown fields and odd model names", () => {
    expect(CredentialsInput.safeParse({ apiKey: "x" }).success).toBe(false);
    expect(CredentialsInput.safeParse({ model: "bad model; drop" }).success).toBe(false);
    expect(CredentialsInput.safeParse({ provider: "openai" }).success).toBe(false);
  });
});

describe("config status with visitor keys", () => {
  it("reports what a job with these credentials can use", () => {
    const c = resolveCredentials(CredentialsInput.parse({ provider: "anthropic" }));
    expect(configStatus(c)).toMatchObject({ llm: { provider: "anthropic", keyName: "ANTHROPIC_API_KEY", keySet: false }, canGenerate: false });
    expect(() => assertCanGenerate(c)).toThrow(/ANTHROPIC_API_KEY is not set/);
    expect(() => assertCanGenerate(resolveCredentials(CredentialsInput.parse({ provider: "anthropic", anthropicKey: "k" })))).not.toThrow();
  });
});

describe("hand-off to the runner", () => {
  it("stash is taken once; discard removes it", () => {
    const creds = resolveCredentials(CredentialsInput.parse({ groqKey: "user" }));
    stashCredentials("zoom.us", creds);
    expect(takeCredentials("zoom.us")).toBe(creds);
    expect(takeCredentials("zoom.us")).toBeUndefined();
    stashCredentials("name:airtable", creds);
    discardCredentials("name:airtable");
    expect(takeCredentials("name:airtable")).toBeUndefined();
    expect(takeCredentials(null)).toBeUndefined();
  });
});

describe("per-job isolation", () => {
  it("currentCredentials is scoped to the job and falls back outside it", async () => {
    expect(currentCredentials().groqKey).toBe("server-groq");
    const inside = await runWithCredentials(resolveCredentials(CredentialsInput.parse({ groqKey: "job-a" })), async () => {
      await new Promise((r) => setTimeout(r, 1));
      return currentCredentials().groqKey;
    });
    expect(inside).toBe("job-a");
  });

  it("two jobs sharing a limiter each send their own key", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { headers: Record<string, string> }) => {
      seen.push(init.headers.Authorization);
      await new Promise((r) => setTimeout(r, 5));
      return Response.json({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }] });
    }));
    const limit = createLimiter(1); // the second job's call is started by the first job's completion
    const job = (key: string) =>
      runWithCredentials(resolveCredentials(CredentialsInput.parse({ groqKey: key })), () =>
        Promise.all([limit(() => groqComplete("p", {})), limit(() => groqComplete("p", {}))]),
      );
    await Promise.all([job("key-A"), job("key-B")]);
    expect(seen.filter((h) => h === "Bearer key-A")).toHaveLength(2);
    expect(seen.filter((h) => h === "Bearer key-B")).toHaveLength(2);
  });
});
