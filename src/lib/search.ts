// Web search via Tavily (behind this module so it can be swapped). Failures are typed ServiceErrors.
import { z } from "zod";
import { env } from "./env";
import { ServiceError, type ServiceErrorCode } from "./service-error";

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

const searchError = (code: ServiceErrorCode, message: string, retryAfterSec?: number) =>
  new ServiceError("search", "tavily", code, message, retryAfterSec);

/** Tavily status codes -> error kinds (432/433 = plan or pay-as-you-go limit exceeded). */
export function tavilyErrorFor(status: number, retryAfter?: number): ServiceError {
  if (status === 401 || status === 403) return searchError("invalid_key", "Tavily rejected TAVILY_API_KEY");
  if (status === 402 || status === 432 || status === 433) return searchError("quota_exhausted", "Tavily search credits are used up");
  if (status === 429) return searchError("rate_limited", "Tavily rate limit reached", retryAfter);
  if (status >= 500) return searchError("unavailable", `Tavily error ${status}`);
  return searchError("rejected", `Search failed: HTTP ${status}`);
}

export async function search(
  query: string,
  opts: { maxResults?: number; includeDomains?: string[] } = {},
): Promise<SearchResult[]> {
  const key = env().TAVILY_API_KEY;
  if (!key) throw searchError("missing_key", "TAVILY_API_KEY is not set");
  let res: Response;
  try {
    res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        query,
        max_results: opts.maxResults ?? 5,
        search_depth: "basic",
        ...(opts.includeDomains?.length ? { include_domains: opts.includeDomains } : {}),
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw searchError("network", "Could not reach the Tavily API");
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw tavilyErrorFor(res.status, Number(res.headers.get("retry-after")) || undefined);
  }
  const parsed = TavilyResponse.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw searchError("rejected", "Unexpected response from Tavily");
  return parsed.data.results.map((r) => ({
    title: r.title ?? "",
    url: r.url,
    snippet: (r.content ?? "").slice(0, 500),
    score: r.score ?? undefined,
  }));
}
