// Step 2 — probes: read-only, unauthenticated GETs against the provider's own hosts.
// Never logs in, never submits forms, never follows into a login flow beyond the first response.
import { env } from "@/lib/env";
import { FETCH_TIMEOUT_MS, readCapped } from "@/lib/fetch-page";
import { insertProbeRun, type ProbeOutcome, type ProbeType } from "@/lib/db/probes";
import { createLimiter } from "@/lib/limit";
import { throwIfAborted } from "../jobs/runner";
import { isOfficialUrl } from "./research";
import type { AgentContext, CandidateFact, ProbeFact, ResearchedPage } from "./types";

interface ProbeResponse {
  status: number | null;
  location?: string;
  contentType?: string;
  body: string;
  error?: string;
}

const limit = createLimiter(3);

async function probeGet(url: string): Promise<ProbeResponse> {
  return limit(async () => {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": env().USER_AGENT, Accept: "application/json,text/html;q=0.9,*/*;q=0.5" },
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const body = res.status >= 300 && res.status < 400 ? "" : await readCapped(res, 256 * 1024);
      if (!body) await res.body?.cancel().catch(() => {});
      return {
        status: res.status,
        location: res.headers.get("location") ?? undefined,
        contentType: res.headers.get("content-type") ?? undefined,
        body,
      };
    } catch (err) {
      return { status: null, body: "", error: err instanceof Error ? err.message : String(err) };
    }
  });
}

const URL_RE = /https?:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[^\s"'<>)\]`]*)?/gi;
const AUTHORIZE_RE = /\/(?:[\w.-]+\/)*(?:authori[sz]e|auth)(?:\/|$|\?)/i;
const SIGN_IN_RE = /log-?in|sign-?in|signin|auth|session|accounts\./i;

function urlsIn(text: string): string[] {
  return [...text.matchAll(URL_RE)].map((m) => m[0].replace(/[.,;:]+$/, ""));
}

const originOf = (u: string) => {
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
};
const basePath = (u: string) => {
  try {
    const x = new URL(u);
    return `${x.origin}${x.pathname}`;
  } catch {
    return null;
  }
};
const shortUrl = (u: string) => (u.length > 90 ? `${u.slice(0, 87)}…` : u);

export async function runProbes(
  ctx: AgentContext,
  pages: ResearchedPage[],
  facts: CandidateFact[],
): Promise<ProbeFact[]> {
  const { app, emit } = ctx;
  const domain = app.primary_domain;
  const related = (u: string) => isOfficialUrl(u, domain);
  const probes: ProbeFact[] = [];

  const record = async (type: ProbeType, url: string, outcome: ProbeOutcome, httpStatus: number | null, summary: string, result?: unknown) => {
    const row = await insertProbeRun({ appId: app.id, probeType: type, targetUrl: url, outcome, httpStatus, result });
    const fact: ProbeFact = { id: `P${probes.length + 1}`, runId: row.id, type, url, outcome, httpStatus, summary };
    probes.push(fact);
    return fact;
  };

  await emit("probe", "info", "Checking OAuth endpoints…");
  const docText = pages.map((p) => p.text).join("\n");
  const docUrls = [...new Set([...urlsIn(docText), ...facts.flatMap((f) => urlsIn(`${f.text} ${f.excerpt}`))])].filter(related);

  // 1 + 2. Discovery documents on the apex domain and any issuer hosts named in the docs.
  const issuerOrigins = new Set<string>([`https://${domain}`]);
  for (const u of docUrls) {
    if (/\.well-known\/(openid-configuration|oauth-authorization-server)/.test(u) || AUTHORIZE_RE.test(new URL(u).pathname)) {
      const o = originOf(u);
      if (o) issuerOrigins.add(o);
    }
  }
  const authorizeCandidates = new Set<string>();
  let foundMetadata = false;
  for (const origin of [...issuerOrigins].slice(0, 3)) {
    throwIfAborted(ctx.signal);
    for (const [type, path] of [
      ["oidc_discovery", "/.well-known/openid-configuration"],
      ["oauth_metadata", "/.well-known/oauth-authorization-server"],
    ] as const) {
      const url = `${origin}${path}`;
      const res = await probeGet(url);
      let meta: Record<string, unknown> | null = null;
      if (res.status === 200) {
        try {
          meta = JSON.parse(res.body) as Record<string, unknown>;
        } catch {
          meta = null;
        }
      }
      if (meta && typeof meta.authorization_endpoint === "string") {
        foundMetadata = true;
        const scopes = Array.isArray(meta.scopes_supported) ? (meta.scopes_supported as unknown[]).map(String).slice(0, 60) : undefined;
        const summary = `${url} returned ${type === "oidc_discovery" ? "an OpenID Connect discovery document" : "OAuth server metadata"} with authorization_endpoint ${meta.authorization_endpoint}` +
          (typeof meta.token_endpoint === "string" ? ` and token_endpoint ${meta.token_endpoint}` : "") +
          (scopes ? `; scopes_supported: ${scopes.join(", ")}` : "");
        await record(type, url, "pass", 200, summary, {
          issuer: meta.issuer, authorization_endpoint: meta.authorization_endpoint, token_endpoint: meta.token_endpoint, scopes_supported: scopes,
        });
        authorizeCandidates.add(String(meta.authorization_endpoint));
        ctx.knownUrls.add(url);
      } else if (origin === `https://${domain}`) {
        await record(type, url, res.status === null ? "error" : "fail", res.status,
          `${url} ${res.status === null ? `could not be reached (${res.error})` : `returned HTTP ${res.status} — no ${type === "oidc_discovery" ? "discovery document" : "metadata"} published here`}`);
      }
    }
  }
  await emit("probe", foundMetadata ? "success" : "info", foundMetadata ? "Found OAuth discovery metadata ✓" : "No discovery document (ok)");

  // 3. Authorize endpoint with a deliberately invalid client_id: proves the endpoint is live.
  for (const u of docUrls) if (AUTHORIZE_RE.test(new URL(u).pathname) && !/\.well-known/.test(u)) authorizeCandidates.add(u);
  const authorizeBases = [...new Set([...authorizeCandidates].map(basePath).filter((u): u is string => !!u && related(u)))].slice(0, 2);
  for (const base of authorizeBases) {
    throwIfAborted(ctx.signal);
    const url = `${base}?client_id=probe_invalid&response_type=code`;
    const res = await probeGet(url);
    const live = res.status !== null && res.status !== 404 && res.status < 500;
    const where = res.location ? ` → redirect to ${shortUrl(res.location)}` : "";
    const fact = await record("authorize_endpoint", url, live ? "pass" : res.status === null ? "error" : "fail", res.status,
      res.status === null
        ? `GET ${base} with an invalid client_id failed (${res.error})`
        : `GET ${base} with client_id=probe_invalid returned HTTP ${res.status}${where} — ${live ? "the authorization endpoint exists and responds" : "endpoint not found at this URL"}`,
      { location: res.location });
    ctx.knownUrls.add(base);
    await emit("probe", live ? "success" : "warn", live ? `Authorize endpoint live ✓ (${fact.httpStatus})` : `Authorize endpoint check failed (${res.status ?? "error"})`);
  }

  // 4. Developer console: does it require sign-in?
  const consoleCandidates = [
    app.developer_portal_url,
    ...facts.filter((f) => f.field === "console_url").flatMap((f) => urlsIn(`${f.text} ${f.excerpt}`)),
  ].filter((u): u is string => !!u && related(u));
  for (const url of [...new Set(consoleCandidates)].slice(0, 2)) {
    throwIfAborted(ctx.signal);
    const res = await probeGet(url);
    let summary: string;
    let requiresSignIn = false;
    if (res.status === null) summary = `${url} could not be reached (${res.error})`;
    else if (res.status >= 300 && res.status < 400 && res.location) {
      requiresSignIn = SIGN_IN_RE.test(res.location);
      summary = `GET ${url} redirected to ${shortUrl(res.location)}${requiresSignIn ? ` — the console requires signing in with a ${app.name} account` : ""}`;
    } else if (res.status === 200) {
      requiresSignIn = /type=["']?password|sign in|log in/i.test(res.body.slice(0, 50_000));
      summary = `GET ${url} returned HTTP 200${requiresSignIn ? " with a sign-in form — the console requires signing in" : ""}`;
    } else summary = `GET ${url} returned HTTP ${res.status}`;
    await record("developer_console", url, res.status === null ? "error" : res.status < 400 ? "pass" : "fail", res.status, summary,
      { location: res.location, requiresSignIn });
    ctx.knownUrls.add(url);
  }

  // 5. Docs pages: research already fetched them (GET, 200) — record that observation.
  for (const p of pages.filter((pg) => pg.official).slice(0, 6)) {
    await record("docs_page", p.url, "pass", 200, `${p.url} returned HTTP 200 (fetched ${p.fetchedAt})`);
  }

  const live = probes.filter((p) => p.outcome === "pass" && p.type !== "docs_page").length;
  await emit("probe", "success", `Ran ${probes.length} probes — ${live} endpoint checks passed ✓`);
  return probes;
}
