// Web search via Tavily (behind this module so it can be swapped).
import { z } from "zod";
import { requireEnv } from "./env";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  score?: number;
}

const TavilyResponse = z.object({
  results: z.array(
    z.object({
      title: z.string().nullish(),
      url: z.string().url(),
      content: z.string().nullish(),
      score: z.number().nullish(),
    }),
  ),
});

export async function search(
  query: string,
  opts: { maxResults?: number; includeDomains?: string[] } = {},
): Promise<SearchResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${requireEnv("TAVILY_API_KEY")}` },
    body: JSON.stringify({
      query,
      max_results: opts.maxResults ?? 5,
      search_depth: "basic",
      ...(opts.includeDomains?.length ? { include_domains: opts.includeDomains } : {}),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Search failed: HTTP ${res.status}`);
  const data = TavilyResponse.parse(await res.json());
  return data.results.map((r) => ({
    title: r.title ?? "",
    url: r.url,
    snippet: (r.content ?? "").slice(0, 500),
    score: r.score ?? undefined,
  }));
}
