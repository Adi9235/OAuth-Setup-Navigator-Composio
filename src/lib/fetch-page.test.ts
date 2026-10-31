import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./env", () => ({
  env: () => ({ USER_AGENT: "TestAgent/1.0", TAVILY_API_KEY: "tvly-test" }),
  requireEnv: () => "test-key",
}));

const { createPageFetcher, fetchPage, htmlToText } = await import("./fetch-page");
const { search } = await import("./search");

const para = "Register your application in the developer settings page. ".repeat(10);
const html = `<html><head><title>Docs</title><script>var x=1</script></head>
<body><nav>Menu Home Pricing</nav><article><h1>Create an OAuth app</h1><p>${para}</p></article></body></html>`;

afterEach(() => vi.unstubAllGlobals());

describe("htmlToText", () => {
  it("extracts readable article text without scripts", () => {
    const { title, text } = htmlToText(html, "https://example.com/docs");
    expect(title).toBeTruthy();
    expect(text).toContain("Register your application");
    expect(text).not.toContain("var x=1");
  });
});

describe("fetchPage", () => {
  it("sends the User-Agent and returns text + hash", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(html, { headers: { "content-type": "text/html" } }));
    vi.stubGlobal("fetch", fetchMock);
    const page = await fetchPage("https://example.com/docs");
    expect(page.ok).toBe(true);
    expect(page.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(fetchMock.mock.calls[0][1].headers["User-Agent"]).toBe("TestAgent/1.0");
  });

  it("reports HTTP errors without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("gone", { status: 404 })));
    const page = await fetchPage("https://example.com/missing");
    expect(page).toMatchObject({ ok: false, status: 404, error: "HTTP 404" });
  });

  it("flags near-empty (JS-rendered) pages", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html><body><div id=root></div></body></html>", { headers: { "content-type": "text/html" } })));
    const page = await fetchPage("https://example.com/spa");
    expect(page.ok).toBe(false);
    expect(page.error).toMatch(/JavaScript/);
  });
});

describe("createPageFetcher", () => {
  it("caches per URL for the job", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(html, { headers: { "content-type": "text/html" } }));
    vi.stubGlobal("fetch", fetchMock);
    const f = createPageFetcher();
    await Promise.all([f.fetch("https://example.com/a"), f.fetch("https://example.com/a#x"), f.fetch("https://example.com/a")]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("search", () => {
  it("maps Tavily results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ results: [{ title: "T", url: "https://example.com/x", content: "snip", score: 0.9 }] })),
    );
    await expect(search("example oauth")).resolves.toEqual([{ title: "T", url: "https://example.com/x", snippet: "snip", score: 0.9 }]);
  });
});

describe("search errors", () => {
  it("maps Tavily HTTP statuses to typed errors", async () => {
    const { tavilyErrorFor } = await import("./search");
    expect(tavilyErrorFor(401)).toMatchObject({ code: "invalid_key", service: "search", provider: "tavily" });
    expect(tavilyErrorFor(432)).toMatchObject({ code: "quota_exhausted" });
    expect(tavilyErrorFor(429, 20)).toMatchObject({ code: "rate_limited", retryAfterSec: 20 });
    expect(tavilyErrorFor(503)).toMatchObject({ code: "unavailable" });
  });

  it("throws a typed error on a failed request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 432 })));
    await expect(search("x")).rejects.toMatchObject({ code: "quota_exhausted" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(search("x")).rejects.toMatchObject({ code: "network" });
  });
});
