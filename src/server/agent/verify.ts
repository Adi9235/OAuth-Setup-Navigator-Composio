// Step 3 — verify each extracted fact against its source with a second, strict LLM pass.
// Facts are batched per source page (one call per page) to fit the job time budget.
import { z } from "zod";
import { normalizeText } from "@/lib/hash";
import { callJson, llmProfile } from "@/lib/llm";
import { settleFailFast } from "@/lib/settle";
import { renderPrompt } from "./prompts";
import { IMPORTANT_FIELDS, type AgentContext, type CandidateFact, type ResearchedPage, type VerifiedFact } from "./types";

const WINDOW = 1500; // chars of context either side of an excerpt
const FALLBACK_CHARS = 24_000; // ~6k tokens

export const VerifySchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      verdict: z.enum(["supported", "partially", "unsupported"]),
      correctedText: z.string().min(3).optional(),
      reason: z.string().default(""),
    }),
  ),
});

/** Page sections around each fact's excerpt; falls back to the start of the page. */
export function relevantSection(pageText: string, excerpts: string[]): string {
  const text = normalizeText(pageText);
  const lower = text.toLowerCase();
  const ranges: [number, number][] = [];
  for (const ex of excerpts) {
    const probe = normalizeText(ex).toLowerCase().slice(0, 60);
    const at = probe.length >= 8 ? lower.indexOf(probe) : -1;
    if (at >= 0) ranges.push([Math.max(0, at - WINDOW), Math.min(text.length, at + probe.length + WINDOW)]);
  }
  if (!ranges.length) return text.slice(0, FALLBACK_CHARS);
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged.map(([a, b]) => text.slice(a, b)).join("\n…\n").slice(0, FALLBACK_CHARS);
}

export function applyVerdict(
  fact: CandidateFact,
  official: boolean,
  v: { verdict: "supported" | "partially" | "unsupported"; correctedText?: string; reason: string } | undefined,
): VerifiedFact | null {
  if (!v) {
    return IMPORTANT_FIELDS.has(fact.field)
      ? { ...fact, official, evidence: "uncertain", verdict: "unsupported", reason: "Verification returned no verdict",
          uncertaintyNote: "Could not be verified against the source" }
      : null;
  }
  if (v.verdict === "supported") return { ...fact, official, evidence: "sourced", verdict: "supported", reason: v.reason };
  if (v.verdict === "partially" && v.correctedText)
    return { ...fact, official, text: v.correctedText, originalText: fact.text, evidence: "sourced", verdict: "partially", reason: v.reason };
  if (IMPORTANT_FIELDS.has(fact.field))
    return { ...fact, official, evidence: "uncertain", verdict: "unsupported", reason: v.reason,
      uncertaintyNote: `The cited page does not clearly confirm this: ${v.reason}` };
  return null;
}

export async function verifyFacts(
  ctx: AgentContext,
  facts: CandidateFact[],
  pages: ResearchedPage[],
): Promise<{ verified: VerifiedFact[]; counts: { confirmed: number; corrected: number; unverifiable: number; dropped: number } }> {
  await ctx.emit("verify", "info", `Verifying ${facts.length} facts against sources…`);
  const byUrl = new Map<string, CandidateFact[]>();
  for (const f of facts) byUrl.set(f.url, [...(byUrl.get(f.url) ?? []), f]);

  const jobs: { page: ResearchedPage; batch: CandidateFact[] }[] = [];
  for (const [url, list] of byUrl) {
    const page = pages.find((p) => p.url === url);
    if (!page) continue;
    const batchSize = llmProfile().verifyBatch;
    for (let i = 0; i < list.length; i += batchSize) jobs.push({ page, batch: list.slice(i, i + batchSize) });
  }

  const verdicts = new Map<string, z.infer<typeof VerifySchema>["results"][number]>();
  // A fatal error (bad key, quota used up) stops the job; a failed batch only loses those facts.
  const settled = await settleFailFast(
    jobs.map(({ page, batch }) => async () => {
      const out = await callJson(
        renderPrompt("verify", {
          url: page.url,
          section: relevantSection(page.text, batch.map((f) => f.excerpt)),
          claims: batch.map((f) => `- ${f.id}: ${f.text}`).join("\n"),
        }),
        VerifySchema,
        { effort: "low", maxTokens: 6000, label: "verify" },
      );
      for (const r of out.results) if (batch.some((f) => f.id === r.id)) verdicts.set(r.id, r);
    }),
    llmProfile().concurrency,
  );
  const failedBatches = settled.filter((s) => s.status === "rejected").length;
  if (failedBatches) await ctx.emit("verify", "warn", `${failedBatches} verification batch(es) failed; those facts are marked uncertain or dropped`);

  const officialByUrl = new Map(pages.map((p) => [p.url, p.official]));
  const verified: VerifiedFact[] = [];
  const counts = { confirmed: 0, corrected: 0, unverifiable: 0, dropped: 0 };
  for (const f of facts) {
    const v = applyVerdict(f, officialByUrl.get(f.url) ?? false, verdicts.get(f.id));
    if (!v) counts.dropped++;
    else {
      verified.push(v);
      if (v.evidence === "uncertain") counts.unverifiable++;
      else if (v.verdict === "partially") counts.corrected++;
      else counts.confirmed++;
    }
  }
  await ctx.emit("verify", "success",
    `${counts.confirmed} confirmed, ${counts.corrected} corrected, ${counts.unverifiable} unverifiable, ${counts.dropped} dropped ✓`, counts);
  return { verified, counts };
}
