// Step 0 (identify) + Step 1 (research): search, fetch, clean, snapshot, extract candidate facts.
import { z } from "zod";
import { recordSnapshot, upsertSource } from "@/lib/db/sources";
import { normalizeText } from "@/lib/hash";
import { callJson, llmProfile } from "@/lib/llm";
import { registrableDomain, type NormalizedInput } from "@/lib/normalize";
import { search, type SearchResult } from "@/lib/search";
import { ServiceError } from "@/lib/service-error";
import { settleFailFast } from "@/lib/settle";
import { throwIfAborted } from "../jobs/runner";
import { renderPrompt } from "./prompts";
import { FACT_FIELDS, type AgentContext, type CandidateFact, type IdentifiedApp, type ResearchedPage } from "./types";


// ---------- identify ----------

const IdentifySchema = z.object({
  name: z.string().min(1).max(80),
  domain: z.string().min(3),
  developerPortalUrl: z.string().url().optional(),
  confidence: z.enum(["high", "medium", "low"]),
  alternatives: z.array(z.string()).default([]),
  docsHosts: z.array(z.string()).default([]),
});

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return null;
  }
};

export async function identifyApp(n: NormalizedInput, knownUrls: Set<string>): Promise<IdentifiedApp> {
  const query = `${n.kind === "domain" ? n.domain : n.name} developer API OAuth`;
  const results = await search(query, { maxResults: 5 });
  results.forEach((r) => knownUrls.add(r.url));
  const out = await callJson(
    renderPrompt("research", {
      input: n.raw,
      domainHint: n.kind === "domain" ? `The user gave a URL; the provider's domain is ${n.domain}.` : "",
      results: results.map((r) => `- ${r.title} | ${r.url}\n  ${r.snippet.slice(0, 300)}`).join("\n") || "(no results)",
    }),
    IdentifySchema,
    { effort: "low", maxTokens: 2000, label: "identify" },
  );

  const domain = n.kind === "domain" ? n.domain : registrableDomain(out.domain);
  if (!domain) throw new Error(`Could not determine a domain for "${n.raw}"`);
  const portal = out.developerPortalUrl && results.some((r) => sameUrl(r.url, out.developerPortalUrl!))
    ? out.developerPortalUrl
    : undefined;
  // Only hosts that really appeared in the search results, and not the provider's own domain.
  const seenHosts = new Set(results.map((r) => hostOf(r.url)).filter((h): h is string => !!h));
  const docsHosts = [...new Set(out.docsHosts.map((h) => h.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")))]
    .filter((h) => seenHosts.has(h) && registrableDomain(h) !== domain)
    .slice(0, 3);
  return { name: out.name.trim(), domain, developerPortalUrl: portal, confidence: out.confidence, alternatives: out.alternatives, docsHosts };
}

/** Hints for recognising official docs; for already-known apps, the stored portal URL's host. */
export function officialHintsFor(app: { name: string; primary_domain: string; developer_portal_url: string | null }, docsHosts: string[] = []): OfficialHints {
  const hosts = new Set(docsHosts);
  const portalHost = app.developer_portal_url ? hostOf(app.developer_portal_url) : null;
  if (portalHost && registrableDomain(portalHost) !== app.primary_domain) hosts.add(portalHost);
  return { docsHosts: [...hosts], brand: app.primary_domain.split(".")[0] };
}

// ---------- research ----------

export function sameUrl(a: string, b: string) {
  const norm = (u: string) => u.replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

/** User-generated areas on a provider's own domain (LinkedIn Pulse, forums...) are community content. */
const COMMUNITY_PATH = /\/(pulse|posts|groups|community|forums?|discussions?|questions|answers)(\/|$)/i;

export interface OfficialHints {
  /** Extra hosts serving the provider's official docs (e.g. learn.microsoft.com for LinkedIn). */
  docsHosts?: string[];
  /** Brand token the URL must mention when it is on one of those hosts (e.g. "linkedin"). */
  brand?: string;
}

/**
 * Official = the provider's registrable domain, or the same brand on another TLD (notion.so /
 * notion.com), or a known docs host whose URL mentions the brand — minus user-generated areas.
 */
export function isOfficialUrl(url: string, appDomain: string, hints: OfficialHints = {}): boolean {
  const d = registrableDomain(url);
  if (!d) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (COMMUNITY_PATH.test(parsed.pathname)) return false;
  if (d === appDomain || d.split(".")[0] === appDomain.split(".")[0]) return true;
  const host = parsed.hostname.toLowerCase();
  const brand = (hints.brand ?? appDomain.split(".")[0]).toLowerCase();
  return !!hints.docsHosts?.includes(host) && `${parsed.pathname}`.toLowerCase().includes(brand);
}

const SKIP = /\.(pdf|png|jpe?g|gif|zip|mp4)(\?|$)|youtube\.com|youtu\.be|twitter\.com|x\.com\//i;
const DOCSY = /(^|\.)(docs?|developers?|dev|api|help|support)\.|\/(docs?|developers?|api|reference|guides?|help)\//i;

export function rankUrls(results: SearchResult[], appDomain: string, max = llmProfile().maxPages, hints: OfficialHints = {}): string[] {
  const best = new Map<string, number>();
  for (const r of results) {
    if (SKIP.test(r.url)) continue;
    const url = r.url.replace(/#.*$/, "");
    const score = (isOfficialUrl(url, appDomain, hints) ? 100 : 0) + (DOCSY.test(url) ? 10 : 0) + (r.score ?? 0) * 10;
    best.set(url, Math.max(best.get(url) ?? 0, score));
  }
  const ranked = [...best.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u);
  const official = ranked.filter((u) => isOfficialUrl(u, appDomain, hints));
  const community = ranked.filter((u) => !isOfficialUrl(u, appDomain, hints)).slice(0, 3);
  return [...official, ...community].slice(0, max);
}

const ExtractSchema = z.object({
  facts: z
    .array(
      z.object({
        field: z.enum(FACT_FIELDS),
        text: z.string().min(3).max(500),
        supportingExcerpt: z.string().min(3),
        scope: z.string().optional(),
        tier: z.enum(["basic", "sensitive", "restricted"]).optional(),
      }),
    )
    .max(40),
});

const looseNorm = (s: string) =>
  normalizeText(s).toLowerCase().replace(/[“”"'‘’`]/g, "").replace(/\s*([.,:;()])\s*/g, "$1");

/** The excerpt must really be on the page (pieces around "..." each >= 20 chars). */
export function excerptOnPage(excerpt: string, pageText: string): boolean {
  const page = looseNorm(pageText);
  const pieces = excerpt.split(/\.{3}|…/).map(looseNorm).filter((p) => p.length >= 20);
  if (!pieces.length) return looseNorm(excerpt).length >= 8 && page.includes(looseNorm(excerpt));
  return pieces.every((p) => page.includes(p));
}

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);
function similar(a: string, b: string) {
  const wa = words(a);
  const wb = words(b);
  const inter = [...wa].filter((w) => wb.has(w)).length;
  return inter / Math.max(1, wa.size + wb.size - inter);
}

const FIELD_PRIORITY = new Map(FACT_FIELDS.map((f, i) => [f, i]));

export function mergeFacts(facts: Omit<CandidateFact, "id">[], officialUrls: Set<string>): CandidateFact[] {
  const kept: Omit<CandidateFact, "id">[] = [];
  const sorted = [...facts].sort((a, b) => Number(officialUrls.has(b.url)) - Number(officialUrls.has(a.url)));
  for (const f of sorted) {
    if (kept.some((k) => k.field === f.field && (k.scope && k.scope === f.scope || similar(k.text, f.text) >= 0.75))) continue;
    kept.push(f);
  }
  return kept
    .sort((a, b) => (FIELD_PRIORITY.get(a.field) ?? 99) - (FIELD_PRIORITY.get(b.field) ?? 99))
    .slice(0, llmProfile().maxFacts)
    .map((f, i) => ({ ...f, id: `F${i + 1}` }));
}

export async function researchApp(ctx: AgentContext): Promise<{ pages: ResearchedPage[]; facts: CandidateFact[] }> {
  const { app, emit } = ctx;
  // Plain brand name for search/extraction: "Google (Workspace APIs)" -> "Google Workspace APIs".
  const name = app.name.replace(/\s*\(([^)]*)\)/, " $1").trim();
  await emit("research", "info", "Searching developer docs…");
  const queries = [
    `${name} create OAuth app`,
    `${name} OAuth app review OR verification OR approval`,
    `${name} OAuth scopes list`,
    `${name} developer terms partner program API access`,
    `${name} marketplace OR app directory publish requirements`,
    `${name} OAuth redirect URI requirements`,
  ];
  const hints = ctx.officialHints;
  const searches = queries.map((q) => () => search(q, { maxResults: 5 }));
  // Providers whose docs live on another host (LinkedIn -> learn.microsoft.com): search there too.
  if (hints.docsHosts?.length) searches.push(() => search(`${name} OAuth app registration`, { maxResults: 5, includeDomains: hints.docsHosts }));
  const settled = await settleFailFast(searches, 3);
  const results = settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
  if (!results.length) {
    const firstError = settled.find((s) => s.status === "rejected");
    if (firstError?.status === "rejected") throw firstError.reason;
    throw new ServiceError("search", "tavily", "rejected", `Web search found nothing for "${name}"`);
  }
  results.forEach((r) => ctx.knownUrls.add(r.url));
  const urls = rankUrls(results, app.primary_domain, undefined, hints);
  if (app.developer_portal_url) ctx.knownUrls.add(app.developer_portal_url);
  await emit("research", "info", `Searched developer docs — ${results.length} results`, { urls });
  throwIfAborted(ctx.signal);

  await emit("research", "info", `Reading ${urls.length} pages…`);
  const fetched = await Promise.all(urls.map((u) => ctx.fetcher.fetch(u)));
  const pages: ResearchedPage[] = [];
  for (const page of fetched) {
    const official = isOfficialUrl(page.finalUrl || page.url, app.primary_domain, hints);
    const source = await upsertSource({
      url: page.url,
      domain: registrableDomain(page.url) ?? app.primary_domain,
      title: page.title ?? null,
      isOfficial: official,
      httpStatus: page.status,
      fetchError: page.error ?? null,
    });
    if (!page.ok || !page.hash) continue;
    const snap = await recordSnapshot(source.id, page.hash, page.text);
    ctx.knownUrls.add(page.url).add(page.finalUrl);
    pages.push({
      url: page.url, finalUrl: page.finalUrl, title: page.title, text: page.text, hash: page.hash,
      fetchedAt: page.fetchedAt, official, sourceId: source.id, snapshotId: snap.snapshotId,
    });
  }
  const failed = fetched.length - pages.length;
  await emit("research", pages.length ? "info" : "warn",
    `Read ${pages.length} pages${failed ? ` (${failed} could not be read)` : ""}`);
  if (!pages.length) return { pages, facts: [] };
  throwIfAborted(ctx.signal);

  await emit("research", "info", "Extracting facts from each page…");
  // A fatal error (bad key, quota used up) stops the job; a single bad page only loses that page.
  const perPage = await settleFailFast(
    pages.map((p) => async () => {
      const out = await callJson(
        renderPrompt("extract", { appName: name, url: p.url, pageText: p.text.slice(0, llmProfile().pageChars) }),
        ExtractSchema,
        { effort: "low", maxTokens: 8000, label: "extract" },
      );
      return out.facts
        .filter((f) => excerptOnPage(f.supportingExcerpt, p.text))
        .map((f) => ({
          field: f.field, text: f.text.trim(), excerpt: f.supportingExcerpt.trim().slice(0, 300), url: p.url,
          scope: f.scope?.trim() || undefined, tier: f.tier,
        }));
    }),
    llmProfile().concurrency,
  );
  const raw = perPage.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const extractFailures = perPage.filter((r) => r.status === "rejected").length;
  if (extractFailures) await emit("research", "warn", `Could not extract facts from ${extractFailures} page(s)`);
  const facts = mergeFacts(raw, new Set(pages.filter((p) => p.official).map((p) => p.url)));
  await emit("research", "success", `Extracted ${facts.length} candidate facts ✓`, { pages: pages.length, facts: facts.length });
  return { pages, facts };
}
