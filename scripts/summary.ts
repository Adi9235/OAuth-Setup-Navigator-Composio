// Console summary of a guide (used by generate/seed scripts).
import type { Guide } from "@/lib/guide-schema";

export function printGuideSummary(guide: Guide, versionNo: number) {
  const claims = [
    ...Object.values(guide.signals), ...guide.prerequisites, ...guide.steps, ...guide.scopes, ...guide.gotchas,
  ];
  const mix = { tested: 0, sourced: 0, uncertain: 0 };
  for (const c of claims) mix[c.evidence]++;
  const s = guide.summary;
  const line = "─".repeat(72);
  console.log(`\n${line}\n${guide.app.name} (${guide.app.domain}) — v${versionNo}`);
  console.log(`${s.difficulty.toUpperCase()} · confidence ${s.confidence} · OAuth: ${guide.app.oauthSupported}${guide.app.oauthVersion ? ` (${guide.app.oauthVersion})` : ""}`);
  console.log(`"${s.oneLiner}"`);
  console.log(`Hands-on: ${s.handsOnMinutes.min}–${s.handsOnMinutes.max} min · Approval wait: ${s.approvalWaitDays.min}–${s.approvalWaitDays.max} days${s.costNote ? ` · Cost: ${s.costNote}` : ""}`);
  console.log("Why this rating:");
  for (const r of s.difficultyReasons) console.log(`  - ${r}`);
  console.log("Signals:");
  for (const [k, v] of Object.entries(guide.signals)) console.log(`  ${k.padEnd(22)} ${String(v.value).padEnd(24)} [${v.evidence}]`);
  console.log(`Steps (${guide.steps.length}):`);
  for (const st of guide.steps) console.log(`  [${st.phase}] ${st.title} — ${st.owner} [${st.evidence}]`);
  console.log(`Evidence mix: ${mix.sourced} sourced · ${mix.tested} tested · ${mix.uncertain} uncertain (${claims.length} claims)`);
  console.log(`Sources: ${guide.sources.length} (${guide.sources.filter((x) => x.official).length} official) · Probes: ${guide.probes.length}`);
  if (guide.openQuestions.length) console.log(`Open questions: ${guide.openQuestions.length}`);
  console.log(`Next action: ${guide.nextAction}\n${line}`);
}
