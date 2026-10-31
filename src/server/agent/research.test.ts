// Research step with all external services mocked (no network, no API credits).
import { describe, expect, it, vi } from "vitest";
import { ServiceError } from "@/lib/service-error";

vi.mock("@/lib/env", () => ({ env: () => ({ USER_AGENT: "Test/1.0", LLM_PROVIDER: "groq" }) }));
const searchMock = vi.fn();
vi.mock("@/lib/search", () => ({ search: (...a: unknown[]) => searchMock(...a) }));
const callJsonMock = vi.fn();
vi.mock("@/lib/llm", () => ({
  callJson: (...a: unknown[]) => callJsonMock(...a),
  llmProfile: () => ({ concurrency: 1, maxPages: 6, pageChars: 14_000, maxFacts: 30, verifyBatch: 25, jobCapMs: 60_000 }),
}));
vi.mock("@/lib/db/sources", () => ({
  upsertSource: vi.fn(async (s: { url: string }) => ({ id: `src-${s.url}` })),
  recordSnapshot: vi.fn(async () => ({ snapshotId: "snap", changed: false, previousSnapshotId: null })),
}));

const { identifyApp, isOfficialUrl, officialHintsFor, researchApp } = await import("./research");

const LINKEDIN_HINTS = { docsHosts: ["learn.microsoft.com"], brand: "linkedin" };

describe("isOfficialUrl with docs hosts", () => {
  it("accepts the provider's docs on a partner host only when the URL names the brand", () => {
    expect(isOfficialUrl("https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow", "linkedin.com", LINKEDIN_HINTS)).toBe(true);
    expect(isOfficialUrl("https://learn.microsoft.com/en-us/azure/active-directory/", "linkedin.com", LINKEDIN_HINTS)).toBe(false);
    expect(isOfficialUrl("https://learn.microsoft.com/en-us/linkedin/", "linkedin.com")).toBe(false);
  });

  it("treats user-generated areas on the provider's domain as community content", () => {
    expect(isOfficialUrl("https://www.linkedin.com/pulse/oauth-roles-scopes-someone", "linkedin.com")).toBe(false);
    expect(isOfficialUrl("https://community.example.com/questions/1", "example.com")).toBe(false);
    expect(isOfficialUrl("https://developer.linkedin.com/product-catalog", "linkedin.com")).toBe(true);
  });

  it("officialHintsFor adds a stored portal URL on another host", () => {
    const hints = officialHintsFor({ name: "LinkedIn", primary_domain: "linkedin.com", developer_portal_url: "https://learn.microsoft.com/en-us/linkedin/" });
    expect(hints).toEqual({ docsHosts: ["learn.microsoft.com"], brand: "linkedin" });
    expect(officialHintsFor({ name: "GitHub", primary_domain: "github.com", developer_portal_url: "https://docs.github.com/en/apps" }).docsHosts).toEqual([]);
  });
});

describe("identifyApp", () => {
  it("keeps only docs hosts that appeared in search results and are off the provider's domain", async () => {
    searchMock.mockResolvedValueOnce([
      { title: "LinkedIn auth", url: "https://learn.microsoft.com/en-us/linkedin/shared/authentication/", snippet: "" },
      { title: "LinkedIn", url: "https://www.linkedin.com/developers/", snippet: "" },
    ]);
    callJsonMock.mockResolvedValueOnce({
      name: "LinkedIn", domain: "linkedin.com", confidence: "high", alternatives: [],
      docsHosts: ["learn.microsoft.com", "invented.example.org", "www.linkedin.com"],
    });
    const id = await identifyApp({ kind: "name", raw: "linkedin", name: "linkedin", slug: "linkedin" }, new Set());
    expect(id.docsHosts).toEqual(["learn.microsoft.com"]);
  });
});

describe("researchApp fail-fast", () => {
  const ctx = () => ({
    jobId: "j", emit: vi.fn(async () => {}), signal: new AbortController().signal, knownUrls: new Set<string>(),
    app: { id: "a", slug: "example", name: "Example", primary_domain: "example.com", aliases: [], category: null, developer_portal_url: null, created_at: new Date() },
    officialHints: {},
    fetcher: { fetch: vi.fn(async (url: string) => ({ url, finalUrl: url, status: 200, ok: true, title: "Docs", text: "Create an app in settings. ".repeat(20), hash: "h", fetchedAt: "2026-10-31T00:00:00Z" })) },
  });

  it("stops at the first quota error instead of extracting every page", async () => {
    searchMock.mockReset().mockResolvedValue([1, 2, 3].map((i) => ({ title: "", url: `https://docs.example.com/p${i}`, snippet: "", score: 1 })));
    callJsonMock.mockReset().mockRejectedValue(new ServiceError("llm", "groq", "quota_exhausted", "daily limit", 280));
    await expect(researchApp(ctx() as never)).rejects.toMatchObject({ code: "quota_exhausted", retryAfterSec: 280 });
    expect(callJsonMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a search key problem instead of 'no results'", async () => {
    searchMock.mockReset().mockRejectedValue(new ServiceError("search", "tavily", "invalid_key", "bad key"));
    await expect(researchApp(ctx() as never)).rejects.toMatchObject({ code: "invalid_key", provider: "tavily" });
  });

  it("keeps going when a single page's extraction output is unusable", async () => {
    searchMock.mockReset().mockResolvedValue([1, 2].map((i) => ({ title: "", url: `https://docs.example.com/p${i}`, snippet: "", score: 1 })));
    callJsonMock.mockReset()
      .mockRejectedValueOnce(new ServiceError("llm", "groq", "bad_output", "invalid JSON"))
      .mockResolvedValueOnce({ facts: [{ field: "setup_step", text: "Create an app in settings.", supportingExcerpt: "Create an app in settings." }] });
    const out = await researchApp(ctx() as never);
    expect(out.facts).toHaveLength(1);
  });
});
