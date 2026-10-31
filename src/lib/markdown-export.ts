// Guide -> Markdown (GET /api/guides/[slug].md). Every claim keeps its evidence tag.
import { formatDays, formatMinutes, OWNER_LABEL, PHASE_LABEL, PHASES, SIGNAL_TITLE, SIGNAL_VALUE_LABEL } from "./format";
import type { Claim, Guide } from "./guide-schema";
import { SIGNAL_KEYS } from "./guide-schema";

const TAG = { tested: "Tested", sourced: "Sourced", uncertain: "Uncertain" } as const;

function evidence(c: Pick<Claim, "evidence" | "sources" | "uncertaintyNote" | "probeId">, guide: Guide): string {
  if (c.evidence === "sourced") return `*[Sourced: ${c.sources.map((s, i) => `[${i + 1}](${s.url})`).join(", ")}]*`;
  if (c.evidence === "tested") {
    const p = guide.probes.find((x) => x.id === c.probeId);
    return `*[Tested${p ? `: ${p.type} ${p.outcome}` : ""}]*`;
  }
  return `*[Uncertain: ${c.uncertaintyNote ?? "not confirmed"}]*`;
}

export function guideToMarkdown(guide: Guide, meta: { url?: string; versionNo?: number; lastVerifiedAt?: string | null } = {}): string {
  const s = guide.summary;
  const out: string[] = [];
  out.push(`# ${guide.app.name} — OAuth app setup guide`, "");
  out.push(`> ${s.oneLiner}`, "");
  out.push(
    `| Difficulty | Hands-on time | Approval wait | Confidence |`,
    `|---|---|---|---|`,
    `| **${s.difficulty}** | ${formatMinutes(s.handsOnMinutes)} | ${formatDays(s.approvalWaitDays)} | ${s.confidence} |`,
    "",
  );
  if (s.costNote) out.push(`**Cost:** ${s.costNote}`, "");
  out.push(`**OAuth supported:** ${guide.app.oauthSupported}${guide.app.oauthVersion ? ` (${guide.app.oauthVersion})` : ""}` +
    (guide.app.developerPortalUrl ? ` · **Developer portal:** ${guide.app.developerPortalUrl}` : ""), "");
  out.push("**Why this rating:**", ...s.difficultyReasons.map((r) => `- ${r}`), "");
  out.push(`## Start here`, "", guide.nextAction, "");

  out.push(`## Who does what`, "", "**An agent can do:**", ...guide.agentVsHuman.agentCan.map((x) => `- ${x}`), "");
  out.push("**You must do:**", ...guide.agentVsHuman.youMust.map((x) => `- ${x}`), "");

  out.push(`## Requirements`, "");
  for (const k of SIGNAL_KEYS) {
    const sig = guide.signals[k];
    out.push(`- **${SIGNAL_TITLE[k]}:** ${SIGNAL_VALUE_LABEL[sig.value] ?? sig.value} — ${sig.text} ${evidence(sig, guide)}`);
  }
  out.push("");
  if (guide.prerequisites.length) {
    out.push(`## Before you start`, "", ...guide.prerequisites.map((c) => `- [ ] ${c.text} ${evidence(c, guide)}`), "");
  }

  out.push(`## Steps`, "");
  let n = 0;
  for (const phase of PHASES) {
    const steps = guide.steps.filter((st) => st.phase === phase);
    if (!steps.length) continue;
    out.push(`### ${PHASE_LABEL[phase]}`, "");
    for (const st of steps) {
      out.push(`${++n}. **${st.title}** (${OWNER_LABEL[st.owner]}) — ${st.text} ${evidence(st, guide)}`);
      if (st.url) out.push(`   - Open: ${st.url}`);
      if (st.agentCanHelp) out.push(`   - Agent can help: ${st.agentCanHelp}`);
      if (st.humanMust) out.push(`   - You must: ${st.humanMust}`);
    }
    out.push("");
  }

  if (guide.scopes.length) {
    out.push(`## Scopes`, "", `| Scope | Tier | Evidence |`, `|---|---|---|`);
    for (const sc of guide.scopes) out.push(`| \`${sc.scope}\` | ${sc.tier} | ${TAG[sc.evidence]} |`);
    out.push("");
  }
  if (guide.gotchas.length || guide.blockers.length) {
    out.push(`## Gotchas & blockers`, "");
    for (const g of guide.gotchas) out.push(`- ${g.text} ${evidence(g, guide)}`);
    for (const b of guide.blockers) out.push(`- **${b.problem}** → ${b.fix} *[${TAG[b.evidence]}]*`);
    out.push("");
  }
  if (guide.openQuestions.length) out.push(`## Open questions`, "", ...guide.openQuestions.map((q) => `- ${q}`), "");

  out.push(`## Sources`, "");
  guide.sources.forEach((src) => out.push(`- [${src.title ?? src.url}](${src.url})${src.official ? "" : " *(community source)*"} — fetched ${src.fetchedAt.slice(0, 10)}`));
  out.push("");
  if (guide.probes.length) {
    out.push(`## Probes run`, "", ...guide.probes.map((p) => `- **${p.type}** (${p.outcome}): ${p.summary}`), "");
  }
  out.push("---", `Generated ${guide.generatedAt.slice(0, 10)}${meta.versionNo ? ` · version ${meta.versionNo}` : ""}` +
    `${meta.lastVerifiedAt ? ` · last verified ${meta.lastVerifiedAt.slice(0, 10)}` : ""}${meta.url ? ` · ${meta.url}` : ""}`);
  return out.join("\n") + "\n";
}
