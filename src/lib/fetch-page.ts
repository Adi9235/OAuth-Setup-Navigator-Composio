// Fetch a public page and reduce it to clean text (Readability + jsdom).
// Respect sites: descriptive UA, 15s timeout, 2MB cap; per-job cache + max 3 concurrent.
import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import { env } from "./env";
import { contentHash } from "./hash";
import { createLimiter } from "./limit";

export const FETCH_TIMEOUT_MS = 15_000;
export const MAX_BYTES = 2 * 1024 * 1024;

export interface FetchedPage {
  url: string;
  finalUrl: string;
  status: number | null;
  ok: boolean;
  title?: string;
  text: string;
  hash: string | null;
  fetchedAt: string;
  error?: string;
}

export function htmlToText(html: string, url: string): { title?: string; text: string } {
  const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
  try {
    const doc = dom.window.document;
    const fallbackTitle = doc.title?.trim() || undefined;
    const article = new Readability(doc).parse();
    const text = article?.textContent?.trim()
      ? article.textContent
      : (new JSDOM(html, { virtualConsole: new VirtualConsole() }).window.document.body?.textContent ?? "");
    return {
      title: article?.title?.trim() || fallbackTitle,
      text: text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(),
    };
  } finally {
    dom.window.close();
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}

export async function fetchPage(url: string, opts: { timeoutMs?: number; maxBytes?: number } = {}): Promise<FetchedPage> {
  const fetchedAt = new Date().toISOString();
  const fail = (error: string, status: number | null = null, finalUrl = url): FetchedPage => ({
    url, finalUrl, status, ok: false, text: "", hash: null, fetchedAt, error,
  });
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": env().USER_AGENT, Accept: "text/html,text/plain,text/markdown;q=0.9,*/*;q=0.5" },
      redirect: "follow",
      signal: AbortSignal.timeout(opts.timeoutMs ?? FETCH_TIMEOUT_MS),
    });
    const finalUrl = res.url || url;
    if (!res.ok) {
      await res.body?.cancel();
      return fail(`HTTP ${res.status}`, res.status, finalUrl);
    }
    const type = res.headers.get("content-type") ?? "";
    const body = await readCapped(res, opts.maxBytes ?? MAX_BYTES);
    let title: string | undefined;
    let text: string;
    if (/html|xml/i.test(type) || /^\s*</.test(body)) {
      ({ title, text } = htmlToText(body, finalUrl));
    } else if (/text|json|markdown/i.test(type) || type === "") {
      text = body.trim();
    } else {
      return fail(`Unsupported content type: ${type}`, res.status, finalUrl);
    }
    if (text.length < 200) return { ...fail("Page has almost no readable text (may need JavaScript)", res.status, finalUrl), title };
    return { url, finalUrl, status: res.status, ok: true, title, text, hash: contentHash(text), fetchedAt };
  } catch (err) {
    const msg = err instanceof Error ? (err.name === "TimeoutError" ? "Timed out after 15s" : err.message) : String(err);
    return fail(msg);
  }
}

/** One per job: caches pages for the job's lifetime and caps concurrency at 3. */
export function createPageFetcher(concurrency = 3) {
  const cache = new Map<string, Promise<FetchedPage>>();
  const limit = createLimiter(concurrency);
  return {
    fetch(url: string): Promise<FetchedPage> {
      const key = url.replace(/#.*$/, "");
      let hit = cache.get(key);
      if (!hit) {
        hit = limit(() => fetchPage(key));
        cache.set(key, hit);
      }
      return hit;
    },
  };
}
export type PageFetcher = ReturnType<typeof createPageFetcher>;
