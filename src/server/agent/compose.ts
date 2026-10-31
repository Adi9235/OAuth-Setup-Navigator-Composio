// Step 4 — compose. The LLM writes drafts that cite fact/probe ids (F3, P2); code resolves those
// citations into evidence + sources, so a "sourced" claim can only point at a page we fetched and a
// "tested" claim only at a probe we ran. Difficulty/confidence are then computed by rules.
import { z } from "zod";
import {
  GuideSchema, SIGNAL_KEYS, type Claim, type Guide, type GuideSource, type Phase, type SignalKey, type SourceRef,
} from "@/lib/guide-schema";
import { callJson } from "@/lib/llm";
import { throwIfAborted } from "../jobs/runner";
import { applyRules, computeDifficulty, signalValues } from "./difficulty";
import { renderPrompt } from "./prompts";
import { sameUrl } from "./research";
import type { AgentContext, ProbeFact, ResearchedPage, VerifiedFact } from "./types";

// ---------- draft schemas (what the LLM returns) ----------

const cite = {
  factIds: z.array(z.string()).default([]),
  probeId: z.string().nullish(),
  uncertaintyNote: z.string().nullish(),
};
const DraftClaim = z.object({ text: z.string().min(3), ...cite });
type DraftClaim = z.infer<typeof DraftClaim>;
const draftSignal = <T extends [string, ...string[]]>(values: T) => DraftClaim.extend({ value: z.enum(values) });
const DraftRange = z.object({ min: z.number().nonnegative(), max: z.number().nonnegative() });

const OverviewDraft = z.object({
  app: z.object({
    oauthSupported: z.enum(["yes", "no", "unclear"]),
    oauthVersion: z.string().nullish(),
    developerPortalUrl: z.string().url().nullish(),
  }),
  summary: z.object({
    oneLiner: z.string().min(3),
    handsOnMinutes: DraftRange,
    approvalWaitDays: DraftRange.extend({ factIds: z.array(z.string()).default([]) }),
    costNote: z.string().nullish(),
  }),
  signals: z.object({
    selfServeRegistration: draftSignal(["yes", "no", "unclear"]),
    reviewRequired: draftSignal(["none", "for_public_distribution", "for_sensitive_scopes", "always", "unclear"]),
    securityAssessment: draftSignal(["no", "conditional", "yes", "unclear"]),
    partnerOrApplication: draftSignal(["no", "for_some_apis", "yes", "unclear"]),
    paidPlanRequired: draftSignal(["no", "for_some_features", "yes", "unclear"]),
    businessVerification: draftSignal(["no", "conditional", "yes", "unclear"]),
    domainOrPrivacyPolicy: draftSignal(["no", "for_review", "yes", "unclear"]),
  }),
  prerequisites: z.array(DraftClaim).max(15),
  agentVsHuman: z.object({ agentCan: z.array(z.string()).max(10), youMust: z.array(z.string()).max(10) }),
  nextAction: z.string().min(3),
  openQuestions: z.array(z.string()).max(12).default([]),
});
type OverviewDraft = z.infer<typeof OverviewDraft>;

const DetailsDraft = z.object({
  steps: z
    .array(
      DraftClaim.extend({
        title: z.string().min(2),
        owner: z.enum(["agent", "you", "both"]),
        phase: z.enum(["prepare", "create", "configure", "test", "submit_review", "go_live"]),
        agentCanHelp: z.string().nullish(),
        humanMust: z.string().nullish(),
        url: z.string().url().nullish(),
      }),
    )
    .min(1)
    .max(20),
  scopes: z.array(DraftClaim.extend({ scope: z.string().min(1), tier: z.enum(["basic", "sensitive", "restricted", "unknown"]) })).max(30).default([]),
  gotchas: z.array(DraftClaim).max(15).default([]),
  blockers: z.array(z.object({ problem: z.string().min(3), fix: z.string().min(3), factIds: z.array(z.string()).default([]), probeId: z.string().nullish() })).max(12).default([]),
});
type DetailsDraft = z.infer<typeof DetailsDraft>;

const CLAIM_TS = `{ text: string; factIds: string[]; probeId?: string; uncertaintyNote?: string }`;

const OVERVIEW_SHAPE = `{
  app: { oauthSupported: "yes"|"no"|"unclear"; oauthVersion?: string /* e.g. "OAuth 2.0 + OIDC" */; developerPortalUrl?: string };
  summary: {
    oneLiner: string /* max 240 chars */;
    handsOnMinutes: { min: number; max: number } /* developer's hands-on time estimate */;
    approvalWaitDays: { min: number; max: number; factIds: string[] } /* {0,0} if no review; cite review_time facts */;
    costNote?: string;
  };
  signals: {  /* each: Claim & { value } */
    selfServeRegistration: ${CLAIM_TS} & { value: "yes"|"no"|"unclear" };
    reviewRequired: ... & { value: "none"|"for_public_distribution"|"for_sensitive_scopes"|"always"|"unclear" };
    securityAssessment: ... & { value: "no"|"conditional"|"yes"|"unclear" };
    partnerOrApplication: ... & { value: "no"|"for_some_apis"|"yes"|"unclear" };
    paidPlanRequired: ... & { value: "no"|"for_some_features"|"yes"|"unclear" };
    businessVerification: ... & { value: "no"|"conditional"|"yes"|"unclear" };
    domainOrPrivacyPolicy: ... & { value: "no"|"for_review"|"yes"|"unclear" };
  };
  prerequisites: Claim[] /* things to have before starting */;
  agentVsHuman: { agentCan: string[]; youMust: string[] };
  nextAction: string;
  openQuestions: string[] /* what the facts do not answer */;
}
where Claim = ${CLAIM_TS}`;

const DETAILS_SHAPE = `{
  steps: (Claim & {
    title: string /* imperative */;
    owner: "agent"|"you"|"both";
    phase: "prepare"|"create"|"configure"|"test"|"submit_review"|"go_live";
    agentCanHelp?: string; humanMust?: string;
    url?: string /* console page to open — only a URL that appears in the facts or probes */;
  })[] /* 4–14 steps in real order */;
  scopes: (Claim & { scope: string; tier: "basic"|"sensitive"|"restricted"|"unknown" })[];
  gotchas: Claim[] /* redirect URI rules, token expiry, test-user limits... */;
  blockers: { problem: string; fix: string; factIds: string[]; probeId?: string }[];
}
where Claim = ${CLAIM_TS}`;

// ---------- prompt rendering ----------

function factLine(f: VerifiedFact): string {
  const tag = f.evidence === "sourced" ? `sourced${f.official ? "" : ", community source"}` : `uncertain: ${f.uncertaintyNote ?? f.reason}`;
  const scope = f.scope ? ` scope=${f.scope}${f.tier ? `/${f.tier}` : ""}` : "";
  return `${f.id} [${f.field}${scope}] (${tag}) ${f.text}\n   source: ${f.url} | excerpt: "${f.excerpt.slice(0, 200)}"`;
}

function promptFor(ctx: AgentContext, part: "overview" | "details", facts: VerifiedFact[], probes: ProbeFact[]) {
  const partInstructions =
    part === "overview"
      ? "Write ONLY the overview part: app, summary, signals, prerequisites, agentVsHuman, nextAction, openQuestions. Another writer handles steps, scopes, gotchas and blockers.\n" +
        "The oneLiner and costNote must agree with the signals: if a signal is \"unclear\", do not claim the opposite in prose " +
        "(e.g. never say \"no review\" unless reviewRequired is \"none\" with a citation; say what is unconfirmed instead). " +
        "A signal value other than \"unclear\" needs a cited fact or probe that states it. " +
        "Never put a review duration in the oneLiner unless a cited review_time fact states it."
      : "Write ONLY the details part: steps, scopes, gotchas, blockers. Another writer handles the summary and signals. Steps must cover the fast path (testing / own workspace) first, then what changes for real users.";
  return renderPrompt("compose", {
    appName: ctx.app.name,
    domain: ctx.app.primary_domain,
    partInstructions,
    schemaJson: part === "overview" ? OVERVIEW_SHAPE : DETAILS_SHAPE,
    facts: facts.map(factLine).join("\n") || "(none — no relevant facts were found on the fetched pages)",
    probes: probes.map((p) => `${p.id} [${p.type}, ${p.outcome}] ${p.summary}`).join("\n") || "(none)",
  });
}

// ---------- citation resolution ----------

export interface Resolver {
  claim(d: DraftClaim): Claim;
  sources(factIds: string[]): SourceRef[];
  /** temp claim id -> facts it cites (for verification_log) */
  citations: Map<string, { facts: VerifiedFact[]; probe?: ProbeFact }>;
}

export function createResolver(facts: VerifiedFact[], probes: ProbeFact[], pages: ResearchedPage[]): Resolver {
  const factMap = new Map(facts.map((f) => [f.id, f]));
  const probeMap = new Map(probes.map((p) => [p.id, p]));
  const titles = new Map(pages.map((p) => [p.url, p.title]));
  const citations = new Map<string, { facts: VerifiedFact[]; probe?: ProbeFact }>();
  let n = 0;

  const toSources = (fs: VerifiedFact[]): SourceRef[] => {
    const seen = new Set<string>();
    return fs.flatMap((f) => {
      if (seen.has(f.url)) return [];
      seen.add(f.url);
      const title = titles.get(f.url);
      return [{ url: f.url, ...(title ? { title } : {}), excerpt: f.excerpt.slice(0, 300) }];
    });
  };

  return {
    citations,
    sources: (ids) => toSources(ids.map((i) => factMap.get(i)).filter((f): f is VerifiedFact => !!f && f.evidence === "sourced")),
    claim(d) {
      const id = `c${++n}`;
      const cited = d.factIds.map((i) => factMap.get(i)).filter((f): f is VerifiedFact => !!f);
      const sourced = cited.filter((f) => f.evidence === "sourced");
      const probe = d.probeId ? probeMap.get(d.probeId) : undefined;
      citations.set(id, { facts: cited, probe });
      if (probe && probe.outcome !== "error")
        return { id, text: d.text, evidence: "tested", probeId: probe.runId, sources: toSources(sourced) };
      if (sourced.length) return { id, text: d.text, evidence: "sourced", sources: toSources(sourced) };
      const note = d.uncertaintyNote?.trim() || cited.find((f) => f.uncertaintyNote)?.uncertaintyNote
        || "Not confirmed by any page or probe the agent checked";
      return { id, text: d.text, evidence: "uncertain", sources: toSources(cited), uncertaintyNote: note };
    },
  };
}

const SIGNAL_LABEL: Record<SignalKey, string> = {
  selfServeRegistration: "whether registration is self-serve",
  reviewRequired: "whether an app review is required",
  securityAssessment: "whether a security assessment is required",
  partnerOrApplication: "whether a partner program or application is required",
  paidPlanRequired: "whether a paid plan is required",
  businessVerification: "whether business verification is required",
  domainOrPrivacyPolicy: "whether a verified domain or privacy policy is required",
};

const clampRange = (r: { min: number; max: number }, lo: number, hi: number) => {
  const a = Math.min(Math.max(Math.round(Math.min(r.min, r.max)), lo), hi);
  const b = Math.min(Math.max(Math.round(Math.max(r.min, r.max)), lo), hi);
  return { min: a, max: b };
};

/** Assemble a schema-valid Guide from the two drafts. Pure (no I/O) — unit-tested. */
export function assembleGuide(input: {
  appName: string;
  domain: string;
  identifiedPortalUrl?: string | null;
  overview: OverviewDraft;
  details: DetailsDraft;
  facts: VerifiedFact[];
  probes: ProbeFact[];
  pages: ResearchedPage[];
  knownUrls: Set<string>;
  now?: Date;
}): { guide: Guide; citations: Resolver["citations"] } {
  const { overview: o, details: d, facts, probes, pages } = input;
  const r = createResolver(facts, probes, pages);
  const factMap = new Map(facts.map((f) => [f.id, f]));
  const isKnown = (u: string, citedText = "") =>
    [...input.knownUrls].some((k) => sameUrl(k, u)) || citedText.includes(u.replace(/\/+$/, ""));

  // Signals: a non-"unclear" value needs sourced/tested evidence, otherwise it becomes "unclear".
  const signals = Object.fromEntries(
    SIGNAL_KEYS.map((key) => {
      const draft = o.signals[key];
      const claim = r.claim(draft);
      if (draft.value === "unclear" || claim.evidence === "uncertain") {
        const note = claim.evidence === "uncertain" ? claim.uncertaintyNote! : draft.uncertaintyNote?.trim() || "The fetched docs do not state this";
        return [key, { ...claim, evidence: "uncertain", probeId: undefined, uncertaintyNote: note, value: "unclear" }];
      }
      return [key, { ...claim, value: draft.value }];
    }),
  ) as Guide["signals"];

  const prerequisites = o.prerequisites.map((p) => r.claim(p));
  const gotchas = d.gotchas.map((g) => r.claim(g));
  const openQuestions = [...o.openQuestions];

  // Approval wait: never present an unsourced number as fact (AGENT_PIPELINE.md).
  const review = signals.reviewRequired.value;
  let approvalWaitDays = { min: 0, max: 0 };
  if (review !== "none") {
    const timing = o.summary.approvalWaitDays.factIds
      .map((i) => factMap.get(i))
      .filter((f): f is VerifiedFact => !!f && f.evidence === "sourced" && f.field === "review_time");
    if (timing.length) approvalWaitDays = clampRange(o.summary.approvalWaitDays, 0, 365);
    else {
      approvalWaitDays = review === "unclear" ? { min: 0, max: 30 } : { min: 1, max: 30 };
      gotchas.unshift({
        id: "timing-1",
        text: review === "unclear"
          ? "Whether a review is needed, and how long it takes, could not be confirmed (0–30 days is a placeholder)."
          : "Review time is not published; 1–30 days is a placeholder range, not a promise.",
        evidence: "uncertain",
        sources: [],
        uncertaintyNote: "No fetched page states a review turnaround time",
      });
    }
  }
  for (const key of SIGNAL_KEYS) {
    if (signals[key].value === "unclear" && !openQuestions.some((q) => q.toLowerCase().includes(SIGNAL_LABEL[key].slice(8, 30))))
      openQuestions.push(`Could not confirm ${SIGNAL_LABEL[key]}.`);
  }

  const steps = d.steps.map((s) => {
    const claim = r.claim(s);
    const citedText = (r.citations.get(claim.id)?.facts ?? []).map((f) => `${f.text} ${f.excerpt}`).join(" ");
    const url = s.url && isKnown(s.url, citedText) ? s.url : undefined;
    return {
      ...claim,
      title: s.title,
      owner: s.owner,
      phase: s.phase as Phase,
      ...(s.agentCanHelp ? { agentCanHelp: s.agentCanHelp } : {}),
      ...(s.humanMust ? { humanMust: s.humanMust } : {}),
      ...(url ? { url } : {}),
    };
  });
  const PHASES: Phase[] = ["prepare", "create", "configure", "test", "submit_review", "go_live"];
  steps.sort((a, b) => PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase)); // stable: keeps order within a phase

  const scopes = d.scopes.map((s) => ({ ...r.claim(s), scope: s.scope, tier: s.tier }));
  const blockers = d.blockers.map((b) => {
    const probe = b.probeId ? probes.find((p) => p.id === b.probeId && p.outcome !== "error") : undefined;
    const sources = r.sources(b.factIds);
    return { problem: b.problem, fix: b.fix, evidence: probe ? "tested" as const : sources.length ? "sourced" as const : "uncertain" as const, sources };
  });

  const portal = [o.app.developerPortalUrl, input.identifiedPortalUrl].find((u): u is string => !!u && isKnown(u));
  const sources: GuideSource[] = pages.map((p) => ({
    url: p.url, ...(p.title ? { title: p.title } : {}), fetchedAt: p.fetchedAt, official: p.official,
  }));

  const draft = {
    schemaVersion: 1 as const,
    app: {
      name: input.appName,
      domain: input.domain,
      oauthSupported: o.app.oauthSupported,
      ...(o.app.oauthVersion ? { oauthVersion: o.app.oauthVersion } : {}),
      ...(portal ? { developerPortalUrl: portal } : {}),
    },
    summary: {
      oneLiner: o.summary.oneLiner.length > 240 ? `${o.summary.oneLiner.slice(0, 237)}…` : o.summary.oneLiner,
      handsOnMinutes: clampRange(o.summary.handsOnMinutes, 5, 60 * 40),
      approvalWaitDays,
      ...(o.summary.costNote ? { costNote: o.summary.costNote } : {}),
    },
    signals,
    prerequisites,
    steps,
    scopes,
    gotchas,
    blockers,
    agentVsHuman: o.agentVsHuman,
    nextAction: o.nextAction,
    sources,
    probes: probes.map((p) => ({ id: p.runId, type: p.type, url: p.url, outcome: p.outcome, summary: p.summary })),
    openQuestions,
    generatedAt: (input.now ?? new Date()).toISOString(),
  };
  return { guide: GuideSchema.parse(applyRules(draft)), citations: r.citations };
}

export async function composeGuide(
  ctx: AgentContext,
  facts: VerifiedFact[],
  probes: ProbeFact[],
  pages: ResearchedPage[],
): Promise<{ guide: Guide; citations: Resolver["citations"] }> {
  await ctx.emit("compose", "info", "Writing the guide…");
  const overviewP = callJson(promptFor(ctx, "overview", facts, probes), OverviewDraft, { effort: "medium", maxTokens: 12000, label: "compose" });
  const detailsP = callJson(promptFor(ctx, "details", facts, probes), DetailsDraft, { effort: "medium", maxTokens: 16000, label: "compose" });

  // Progressive preview: the summary can be shown as soon as the overview lands.
  void overviewP
    .then((o) => {
      const v = Object.fromEntries(SIGNAL_KEYS.map((k) => [k, o.signals[k].value])) as ReturnType<typeof signalValues>;
      const rough = computeDifficulty(v);
      return ctx.emit("compose", "info", "Summary drafted", {
        section: "summary",
        data: { oneLiner: o.summary.oneLiner, difficulty: rough.difficulty, handsOnMinutes: o.summary.handsOnMinutes, nextAction: o.nextAction },
      });
    })
    .catch(() => {});
  void detailsP
    .then((d) => ctx.emit("compose", "info", `Drafted ${d.steps.length} steps`, {
      section: "steps",
      data: { steps: d.steps.map((s) => ({ title: s.title, owner: s.owner, phase: s.phase })) },
    }))
    .catch(() => {});

  const [overview, details] = await Promise.all([overviewP, detailsP]);
  throwIfAborted(ctx.signal);
  return assembleGuide({
    appName: ctx.app.name,
    domain: ctx.app.primary_domain,
    identifiedPortalUrl: ctx.app.developer_portal_url,
    overview,
    details,
    facts,
    probes,
    pages,
    knownUrls: ctx.knownUrls,
  });
}

export type { OverviewDraft, DetailsDraft };
