// Re-check job (EVIDENCE_AND_VERIFICATION.md "Change tracking"): re-fetch every source of the current
// version, compare hashes, re-verify only claims linked to changed pages, re-run probes, and write a
// new version only if something actually changed.
import { diffLines } from "diff";
import { z } from "zod";
import { getAppById } from "@/lib/db/apps";
import { claimsForSources, setClaimStatus } from "@/lib/db/claims";
import { getGuideByAppId, getVersion, markVerified, setFreshness, type Freshness } from "@/lib/db/guides";
import { getProbeRuns } from "@/lib/db/probes";
import {
  getSnapshot, getSourcesByUrls, insertChangeEvent, markSourceFetchError, recordSnapshot, setChangeEventVersion,
} from "@/lib/db/sources";
import { createPageFetcher } from "@/lib/fetch-page";
import type { Claim, Guide } from "@/lib/guide-schema";
import { SIGNAL_KEYS } from "@/lib/guide-schema";
import { callJson } from "@/lib/llm";
import { throwIfAborted, type JobHandler } from "../jobs/runner";
import { applyRules } from "./difficulty";
import { claimSlots, saveGuideVersion, type SourceLookup } from "./persist";
import { runProbes } from "./probe";
import { officialHintsFor } from "./research";
import { renderPrompt } from "./prompts";
import type { AgentContext, ResearchedPage } from "./types";
import { relevantSection, VerifySchema } from "./verify";

const ImpactSchema = z.object({
  impact: z.enum(["none", "minor", "breaking"]),
  affectedClaimIds: z.array(z.string()).default([]),
  summary: z.string().default(""),
});

/** Changed paragraphs only, as a compact +/- diff (capped). */
export function compactDiff(oldText: string, newText: string, maxChars = 6000): string {
  const para = (t: string) => t.split(/\n{2,}/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
  const out: string[] = [];
  for (const part of diffLines(para(oldText), para(newText))) {
    if (!part.added && !part.removed) continue;
    for (const line of part.value.split("\n").filter(Boolean)) out.push(`${part.added ? "+" : "-"} ${line}`);
  }
  const text = out.join("\n");
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…(truncated)` : text;
}

export const recheckPipeline: JobHandler = async ({ job, emit, signal }) => {
  const app = job.app_id ? await getAppById(job.app_id) : null;
  if (!app) throw new Error("Re-check job has no app");
  const guideRow = await getGuideByAppId(app.id);
  const version = guideRow?.current_version_id ? await getVersion(guideRow.current_version_id) : null;
  if (!guideRow || !version) throw new Error(`${app.name} has no published guide to re-check`);
  await setFreshness(guideRow.id, "rechecking");

  try {
    const guide: Guide = structuredClone(version.content);
    const fetcher = createPageFetcher(3);
    const changes: string[] = [];
    const changeEventIds: string[] = [];
    let unresolvedBreaking = false;
    let missingWithClaims = false;

    // 1. Re-fetch every source and compare hashes.
    await emit("fetch", "info", `Re-fetching ${guide.sources.length} source pages…`);
    const known = new Map((await getSourcesByUrls(guide.sources.map((s) => s.url))).map((s) => [s.url, s]));
    const pages: ResearchedPage[] = [];
    const changed: { url: string; text: string; sourceId: string; oldSnapshotId: string | null; newSnapshotId: string }[] = [];
    await Promise.all(
      guide.sources.map(async (src) => {
        const row = known.get(src.url);
        if (!row) return;
        const page = await fetcher.fetch(src.url);
        if (!page.ok || !page.hash) {
          await markSourceFetchError(row.id, page.status, page.error ?? "fetch failed");
          if (page.status === 404 || page.status === 410) {
            const linked = await claimsForSources(version.id, [row.id]);
            await setClaimStatus(linked.map((c) => c.id), "needs_review");
            if (linked.length) missingWithClaims = true;
            changes.push(`${src.url} is gone (HTTP ${page.status}); ${linked.length} claim(s) need review`);
            await emit("fetch", "warn", `Page gone (HTTP ${page.status}): ${src.url}`);
          } else {
            await emit("fetch", "warn", `Could not re-fetch ${src.url} (${page.error})`);
          }
          return;
        }
        const snap = await recordSnapshot(row.id, page.hash, page.text);
        pages.push({
          url: src.url, finalUrl: page.finalUrl, title: page.title, text: page.text, hash: page.hash,
          fetchedAt: page.fetchedAt, official: src.official, sourceId: row.id, snapshotId: snap.snapshotId,
        });
        if (snap.changed) changed.push({ url: src.url, text: page.text, sourceId: row.id, oldSnapshotId: snap.previousSnapshotId, newSnapshotId: snap.snapshotId });
      }),
    );
    await emit("fetch", "success", changed.length ? `${changed.length} page(s) changed since last check` : "No source pages changed ✓");
    throwIfAborted(signal);

    // 2. For changed pages: diff, ask which claims are affected, re-verify only those.
    const slots = claimSlots(guide);
    const touched = new Set<Claim>();
    for (const c of changed) {
      const dependents = slots.filter((s) => s.claim.sources.some((x) => x.url === c.url));
      const oldText = c.oldSnapshotId ? (await getSnapshot(c.oldSnapshotId))?.content_text ?? "" : "";
      const diff = compactDiff(oldText, c.text);
      if (!dependents.length || !diff) {
        changeEventIds.push((await insertChangeEvent({ sourceId: c.sourceId, oldSnapshotId: c.oldSnapshotId, newSnapshotId: c.newSnapshotId, impact: "none", affectedClaimIds: [] }))!.id);
        continue;
      }
      await emit("verify", "info", `Checking what changed on ${new URL(c.url).pathname}…`);
      const impact = await callJson(
        renderPrompt("impact", {
          url: c.url,
          diff,
          claims: dependents.map((d) => `- ${d.claim.id}: ${d.claim.text}`).join("\n"),
        }),
        ImpactSchema,
        { effort: "low", maxTokens: 3000, label: "impact" },
      );
      const affected = dependents.filter((d) => impact.affectedClaimIds.includes(d.claim.id));
      const affectedUuids = affected.map((a) => a.claim.id.replace(/^timing:/, "")).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
      changeEventIds.push((await insertChangeEvent({
        sourceId: c.sourceId, oldSnapshotId: c.oldSnapshotId, newSnapshotId: c.newSnapshotId,
        diffSummary: impact.summary, impact: impact.impact, affectedClaimIds: affectedUuids,
      }))!.id);
      if (impact.impact === "none" || !affected.length) continue;

      const result = await callJson(
        renderPrompt("verify", {
          url: c.url,
          section: relevantSection(c.text, affected.flatMap((a) => a.claim.sources.filter((s) => s.url === c.url).map((s) => s.excerpt ?? ""))),
          claims: affected.map((a) => `- ${a.claim.id}: ${a.claim.text}`).join("\n"),
        }),
        VerifySchema,
        { effort: "low", maxTokens: 4000, label: "verify" },
      );
      for (const a of affected) {
        const v = result.results.find((r) => r.id === a.claim.id);
        if (v?.verdict === "supported") continue;
        touched.add(a.claim);
        if (v?.verdict === "partially" && v.correctedText) {
          changes.push(`updated "${a.claim.text.slice(0, 60)}"`);
          a.claim.text = v.correctedText;
        } else {
          changes.push(`no longer confirmed: "${a.claim.text.slice(0, 60)}"`);
          a.claim.evidence = "uncertain";
          a.claim.probeId = undefined;
          a.claim.uncertaintyNote = `The source page changed and no longer clearly states this${v?.reason ? `: ${v.reason}` : ""}`;
          if (impact.impact === "breaking") unresolvedBreaking = true;
        }
      }
    }
    throwIfAborted(signal);

    // 3. Re-run probes; a changed outcome invalidates tested claims that relied on it.
    const ctx: AgentContext = { jobId: job.id, app, emit, signal, fetcher, knownUrls: new Set(), officialHints: officialHintsFor(app) };
    const newProbes = await runProbes(ctx, pages, []);
    const oldRuns = new Map((await getProbeRuns(guide.probes.map((p) => p.id))).map((r) => [r.id, r]));
    for (const old of guide.probes) {
      const prev = oldRuns.get(old.id);
      const now = newProbes.find((p) => p.type === old.type && p.url === old.url);
      if (!prev || !now || now.outcome === prev.outcome) continue;
      changes.push(`probe ${old.type} changed: ${prev.outcome} → ${now.outcome}`);
      for (const s of slots) {
        if (s.claim.evidence === "tested" && s.claim.probeId === old.id) {
          touched.add(s.claim);
          s.claim.evidence = s.claim.sources.length ? "sourced" : "uncertain";
          s.claim.probeId = undefined;
          if (s.claim.evidence === "uncertain") s.claim.uncertaintyNote = `Re-running the probe gave a different result (${now.summary})`;
        }
      }
      const idx = guide.probes.findIndex((p) => p.id === old.id);
      guide.probes[idx] = { id: now.runId, type: now.type, url: now.url, outcome: now.outcome, summary: now.summary };
    }

    // 4. Anything changed -> new version (unchanged claims copied), rules recomputed.
    const freshness: Freshness = unresolvedBreaking || missingWithClaims ? "outdated" : "fresh";
    if (!touched.size) {
      await markVerified(guideRow.id, freshness);
      const msg = changes.length ? `No guide changes needed (${changes.join("; ")})` : "Everything still matches the sources ✓";
      await emit("compose", "success", msg);
      return { slug: app.slug, message: freshness === "fresh" ? "Re-check complete — guide is up to date ✓" : "Re-check complete — some sources need review" };
    }
    for (const k of SIGNAL_KEYS) {
      const sig = guide.signals[k];
      if (sig.evidence === "uncertain" && sig.value !== "unclear") {
        (sig as { value: string }).value = "unclear";
      }
    }
    const updated = applyRules({ ...guide, generatedAt: new Date().toISOString() });
    const lookup: SourceLookup = new Map(
      (await getSourcesByUrls(updated.sources.map((s) => s.url))).map((s) => [s.url, { sourceId: s.id, snapshotId: s.latest_snapshot_id }]),
    );
    const changeSummary = `Re-check: ${changes.slice(0, 4).join("; ")}${changes.length > 4 ? `; +${changes.length - 4} more` : ""}`.slice(0, 500);
    const saved = await saveGuideVersion({ app, guide: updated, sources: lookup, jobId: job.id, changeSummary });
    await setChangeEventVersion(changeEventIds, saved.versionId);
    await markVerified(guideRow.id, freshness);
    await emit("compose", "success", `Saved version ${saved.versionNo}: ${changeSummary}`);
    return { slug: app.slug, message: `Guide updated to version ${saved.versionNo} ✓` };
  } catch (err) {
    await setFreshness(guideRow.id, guideRow.freshness === "rechecking" ? "fresh" : guideRow.freshness).catch(() => {});
    throw err;
  }
};
