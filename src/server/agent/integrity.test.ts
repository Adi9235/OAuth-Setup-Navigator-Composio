// Integrity guarantees of the agent: no invented sources, URLs, or numbers. Fictional data only.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ env: () => ({ USER_AGENT: "Test/1.0", LLM_PROVIDER: "anthropic" }), requireEnv: () => "k" }));

const { assembleGuide } = await import("./compose");
const { excerptOnPage, isOfficialUrl, mergeFacts, rankUrls } = await import("./research");
const { applyVerdict, relevantSection } = await import("./verify");
type Facts = Parameters<typeof assembleGuide>[0]["facts"];
type Overview = Parameters<typeof assembleGuide>[0]["overview"];
type Details = Parameters<typeof assembleGuide>[0]["details"];

const page = {
  url: "https://docs.example.com/oauth", finalUrl: "https://docs.example.com/oauth", title: "OAuth",
  text: "...", hash: "h", fetchedAt: "2026-10-31T00:00:00Z", official: true, sourceId: "s1", snapshotId: "n1",
};
const facts: Facts = [
  { id: "F1", field: "self_serve_registration", text: "Anyone can create an app in settings.", excerpt: "Anyone can create an app", url: page.url, evidence: "sourced", verdict: "supported", reason: "", official: true },
  { id: "F2", field: "review_required", text: "Public apps are reviewed.", excerpt: "Public apps are reviewed", url: page.url, evidence: "sourced", verdict: "supported", reason: "", official: true },
  { id: "F3", field: "review_time", text: "Review takes about 2 weeks.", excerpt: "about 2 weeks", url: page.url, evidence: "uncertain", verdict: "unsupported", reason: "not stated", uncertaintyNote: "Not on page", official: true },
];
const probes = [{ id: "P1", runId: "11111111-1111-1111-1111-111111111111", type: "developer_console" as const, url: "https://example.com/apps", outcome: "pass" as const, httpStatus: 302, summary: "redirects to sign-in" }];

const sig = (value: string, factIds: string[] = []) => ({ value, text: `signal ${value}`, factIds }) as never;
function overview(over: Partial<Overview> = {}): Overview {
  return {
    app: { oauthSupported: "yes", developerPortalUrl: "https://invented.example.com/console" },
    summary: { oneLiner: "Quick.", handsOnMinutes: { min: 10, max: 20 }, approvalWaitDays: { min: 3, max: 5, factIds: ["F3"] } },
    signals: {
      selfServeRegistration: sig("yes", ["F1"]),
      reviewRequired: sig("for_public_distribution", ["F2"]),
      securityAssessment: sig("yes"), // no citation -> must become unclear
      partnerOrApplication: sig("no", ["F99"]), // unknown fact id -> unclear
      paidPlanRequired: sig("unclear"),
      businessVerification: sig("no", ["F1"]),
      domainOrPrivacyPolicy: sig("no", ["F1"]),
    },
    prerequisites: [{ text: "An Example account", factIds: ["F1"] }],
    agentVsHuman: { agentCan: ["Draft text"], youMust: ["Sign in"] },
    nextAction: "Open settings",
    openQuestions: [],
    ...over,
  };
}
const details: Details = {
  steps: [
    { title: "Sign in to the console", text: "The console requires sign-in.", factIds: [], probeId: "P1", owner: "you", phase: "create", url: "https://example.com/apps" },
    { title: "Create the app", text: "Create an app in settings.", factIds: ["F1"], owner: "you", phase: "create", url: "https://made-up.example.org/new" },
    { title: "Prepare redirect URIs", text: "List callback URLs.", factIds: [], owner: "agent", phase: "prepare" },
  ],
  scopes: [],
  gotchas: [],
  blockers: [{ problem: "Rejected", fix: "Resubmit", factIds: ["F404"] }],
};
const known = new Set([page.url, "https://example.com/apps"]);
const build = (o = overview(), d = details) =>
  assembleGuide({ appName: "Example", domain: "example.com", overview: o, details: d, facts, probes, pages: [page], knownUrls: known });

describe("assembleGuide", () => {
  it("only cites fetched URLs and existing probes", () => {
    const { guide } = build();
    const claims = [...Object.values(guide.signals), ...guide.prerequisites, ...guide.steps];
    for (const c of claims) {
      for (const s of c.sources) expect(s.url).toBe(page.url);
      if (c.evidence === "tested") expect(c.probeId).toBe(probes[0].runId);
    }
    expect(guide.steps.find((s) => s.title.startsWith("Sign in"))?.evidence).toBe("tested");
  });

  it("downgrades signals without valid evidence to unclear/uncertain", () => {
    const { guide } = build();
    expect(guide.signals.securityAssessment).toMatchObject({ value: "unclear", evidence: "uncertain" });
    expect(guide.signals.partnerOrApplication).toMatchObject({ value: "unclear", evidence: "uncertain" });
    expect(guide.signals.reviewRequired).toMatchObject({ value: "for_public_distribution", evidence: "sourced" });
  });

  it("difficulty comes from rules on the resolved signals (uncited 'yes' assessment does not fire R2)", () => {
    const { guide } = build();
    expect(guide.summary.difficulty).toBe("medium");
    expect(guide.summary.difficultyReasons[0]).toMatch(/^R5/);
  });

  it("drops URLs that were never seen and keeps known ones", () => {
    const { guide } = build();
    expect(guide.app.developerPortalUrl).toBeUndefined();
    expect(guide.steps.find((s) => s.title === "Create the app")?.url).toBeUndefined();
    expect(guide.steps.find((s) => s.title.startsWith("Sign in"))?.url).toBe("https://example.com/apps");
  });

  it("uses a placeholder approval wait when no sourced review_time fact backs it", () => {
    const { guide } = build();
    expect(guide.summary.approvalWaitDays).toEqual({ min: 1, max: 30 });
    expect(guide.gotchas[0]).toMatchObject({ evidence: "uncertain", id: "timing-1" });
  });

  it("no review -> 0-0 days; uncited items become uncertain with a note", () => {
    const o = overview();
    o.signals.reviewRequired = sig("none", ["F1"]);
    const { guide } = build(o);
    expect(guide.summary.approvalWaitDays).toEqual({ min: 0, max: 0 });
    const prep = guide.steps.find((s) => s.title === "Prepare redirect URIs")!;
    expect(prep.evidence).toBe("uncertain");
    expect(prep.uncertaintyNote).toBeTruthy();
    expect(guide.blockers[0].evidence).toBe("uncertain");
  });

  it("orders steps by phase and adds open questions for unclear signals", () => {
    const { guide } = build();
    expect(guide.steps[0].phase).toBe("prepare");
    expect(guide.openQuestions.some((q) => /security assessment/.test(q))).toBe(true);
  });
});

describe("stripCitationIds", () => {
  it("removes leaked fact/probe ids from prose but keeps normal words", async () => {
    const { stripCitationIds } = await import("./compose");
    expect(stripCitationIds("Open the console and create a client (see F1,F2).")).toBe("Open the console and create a client.");
    expect(stripCitationIds("Review is required [F3, P2] for public apps")).toBe("Review is required for public apps");
    expect(stripCitationIds("Scopes are listed in the docs, see F4.")).toBe("Scopes are listed in the docs.");
    expect(stripCitationIds("Press F12 to open devtools")).toBe("Press F12 to open devtools");
    expect(stripCitationIds("Uses HTTP/2 and TLS")).toBe("Uses HTTP/2 and TLS");
  });

  it("assembleGuide scrubs ids from every text field", () => {
    const o = overview({ nextAction: "Create the app (see F1, F2)" });
    const { guide } = build(o);
    expect(guide.nextAction).toBe("Create the app");
  });
});

describe("research helpers", () => {
  it("excerptOnPage requires the excerpt to really be on the page", () => {
    const text = "To publish, your app must pass review. Reviews usually take 5 business days.";
    expect(excerptOnPage("your app must pass review", text)).toBe(true);
    expect(excerptOnPage("“Reviews usually take 5 business days.”", text)).toBe(true);
    expect(excerptOnPage("Reviews take 2 days", text)).toBe(false);
  });

  it("isOfficialUrl accepts same domain and same brand on another TLD", () => {
    expect(isOfficialUrl("https://developers.notion.com/docs", "notion.so")).toBe(true);
    expect(isOfficialUrl("https://stackoverflow.com/q/1", "notion.so")).toBe(false);
  });

  it("rankUrls puts official docs first and caps community pages", () => {
    const r = (url: string, score = 0.5) => ({ title: "", url, snippet: "", score });
    const ranked = rankUrls(
      [r("https://medium.com/a", 0.99), r("https://example.com/docs/oauth", 0.2), r("https://reddit.com/x"), r("https://dev.to/y"), r("https://blog.z.com/q"), r("https://example.com/file.pdf")],
      "example.com",
    );
    expect(ranked[0]).toBe("https://example.com/docs/oauth");
    expect(ranked).not.toContain("https://example.com/file.pdf");
    expect(ranked.length).toBe(4);
  });

  it("mergeFacts dedupes near-identical facts and assigns ids", () => {
    const f = (text: string) => ({ field: "setup_step" as const, text, excerpt: text, url: "https://example.com/a" });
    const merged = mergeFacts([f("Open the developer settings page"), f("Open the developer settings page."), f("Click New app")], new Set());
    expect(merged.map((m) => m.id)).toEqual(["F1", "F2"]);
  });
});

describe("verify helpers", () => {
  const fact = { id: "F1", field: "review_time" as const, text: "Review takes 5 days", excerpt: "5 days", url: "https://e.com" };

  it("supported -> sourced, partially -> corrected text, unsupported important -> uncertain", () => {
    expect(applyVerdict(fact, true, { verdict: "supported", reason: "" })?.evidence).toBe("sourced");
    const p = applyVerdict(fact, true, { verdict: "partially", correctedText: "Review takes up to 5 business days", reason: "" });
    expect(p).toMatchObject({ evidence: "sourced", text: "Review takes up to 5 business days", originalText: "Review takes 5 days" });
    expect(applyVerdict(fact, true, { verdict: "unsupported", reason: "no number" })?.evidence).toBe("uncertain");
  });

  it("unsupported non-important facts are dropped", () => {
    expect(applyVerdict({ ...fact, field: "setup_step" }, true, { verdict: "unsupported", reason: "" })).toBeNull();
  });

  it("relevantSection centers on the excerpt", () => {
    const text = `${"filler ".repeat(1000)}Apps must be reviewed before launch.${" tail".repeat(1000)}`;
    const sec = relevantSection(text, ["Apps must be reviewed before launch."]);
    expect(sec).toContain("Apps must be reviewed");
    expect(sec.length).toBeLessThan(text.length);
  });
});
