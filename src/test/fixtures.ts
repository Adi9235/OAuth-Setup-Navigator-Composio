// Fictional sample guide for tests only ("Example App", example.com) — not real provider facts.
import type { Guide, Signals } from "@/lib/guide-schema";
import type { SignalValues } from "@/server/agent/difficulty";

const src = { url: "https://example.com/docs/oauth", title: "Example OAuth docs", excerpt: "Create an app in settings." };

export function signalsFrom(values: Partial<SignalValues> = {}): Signals {
  const v: SignalValues = {
    selfServeRegistration: "yes",
    reviewRequired: "none",
    securityAssessment: "no",
    partnerOrApplication: "no",
    paidPlanRequired: "no",
    businessVerification: "no",
    domainOrPrivacyPolicy: "no",
    ...values,
  };
  const claim = (id: string, value: string) =>
    value === "unclear"
      ? { id, text: `${id} could not be determined`, evidence: "uncertain" as const, sources: [], uncertaintyNote: "Docs do not say" }
      : { id, text: `${id} is ${value}`, evidence: "sourced" as const, sources: [src] };
  return {
    selfServeRegistration: { ...claim("selfServe", v.selfServeRegistration), value: v.selfServeRegistration },
    reviewRequired: { ...claim("review", v.reviewRequired), value: v.reviewRequired },
    securityAssessment: { ...claim("assessment", v.securityAssessment), value: v.securityAssessment },
    partnerOrApplication: { ...claim("partner", v.partnerOrApplication), value: v.partnerOrApplication },
    paidPlanRequired: { ...claim("paid", v.paidPlanRequired), value: v.paidPlanRequired },
    businessVerification: { ...claim("business", v.businessVerification), value: v.businessVerification },
    domainOrPrivacyPolicy: { ...claim("domain", v.domainOrPrivacyPolicy), value: v.domainOrPrivacyPolicy },
  };
}

export function sampleGuide(overrides: Partial<Guide> = {}): Guide {
  return {
    schemaVersion: 1,
    app: { name: "Example App", domain: "example.com", oauthSupported: "yes", oauthVersion: "OAuth 2.0" },
    summary: {
      oneLiner: "Self-serve in minutes; no review for basic use.",
      difficulty: "easy",
      difficultyReasons: ["R8: Self-serve with no review, assessment, or paid plan found"],
      handsOnMinutes: { min: 10, max: 30 },
      approvalWaitDays: { min: 0, max: 0 },
      confidence: "high",
    },
    signals: signalsFrom(),
    prerequisites: [{ id: "p1", text: "An Example account", evidence: "sourced", sources: [src] }],
    steps: [
      {
        id: "s1",
        text: "Open developer settings and create a new OAuth app.",
        evidence: "tested",
        sources: [],
        probeId: "probe-1",
        title: "Create the OAuth app",
        owner: "you",
        phase: "create",
        url: "https://example.com/settings/apps",
      },
    ],
    scopes: [],
    gotchas: [],
    blockers: [{ problem: "Redirect URI mismatch", fix: "Register the exact callback URL", evidence: "sourced", sources: [src] }],
    agentVsHuman: { agentCan: ["Prepare redirect URIs"], youMust: ["Sign in to the console"] },
    nextAction: "Sign in and open developer settings.",
    sources: [{ ...src, fetchedAt: "2026-10-31T00:00:00.000Z", official: true }],
    probes: [{ id: "probe-1", type: "developer_console", url: "https://example.com/settings/apps", outcome: "pass", summary: "Redirects to sign-in" }],
    openQuestions: [],
    generatedAt: "2026-10-31T00:00:00.000Z",
    ...overrides,
  };
}
