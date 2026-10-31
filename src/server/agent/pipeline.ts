// Orchestrates identify → research → probe → verify → compose → persist for a generate job.
// Each step writes its results to the DB before the next starts, so a crash loses at most one step.
import { addAliases, findAppByDomain, getAppById, insertApp } from "@/lib/db/apps";
import { getGuideByAppId } from "@/lib/db/guides";
import { setJobApp } from "@/lib/db/jobs";
import { createPageFetcher } from "@/lib/fetch-page";
import { normalizeInput, slugify } from "@/lib/normalize";
import { throwIfAborted, type JobHandler } from "../jobs/runner";
import { composeGuide } from "./compose";
import { saveGuideVersion, type SourceLookup } from "./persist";
import { runProbes } from "./probe";
import { identifyApp, researchApp } from "./research";
import type { AgentContext } from "./types";
import { verifyFacts } from "./verify";

export const generatePipeline: JobHandler = async ({ job, emit, signal }) => {
  const n = normalizeInput(job.input_text);
  if (!n) throw new Error("Enter an app name or URL");
  const knownUrls = new Set<string>();

  // Step 0 — identify
  await emit("identify", "info", "Identifying the app…");
  let app = job.app_id ? await getAppById(job.app_id) : null;
  if (!app) {
    const id = await identifyApp(n, knownUrls);
    if (id.confidence === "low" || id.alternatives.length) {
      const alt = id.alternatives.length ? ` (other matches: ${id.alternatives.slice(0, 3).join(", ")})` : "";
      await emit("identify", "warn", `Assuming you meant ${id.name} (${id.domain})${alt}`);
    }
    const existing = await findAppByDomain(id.domain);
    if (existing) {
      const g = await getGuideByAppId(existing.id);
      if (g?.status === "published" && g.current_version_id) {
        if (n.kind === "name") await addAliases(existing.id, [n.name]);
        await emit("identify", "success", `${existing.name} is already in the library ✓`);
        return { slug: existing.slug, message: "Guide already exists ✓" };
      }
    }
    // Move this job's dedupe key to the real domain; hand off if another job already has it.
    const claim = await setJobApp(job.id, { appId: existing?.id ?? null, domain: id.domain });
    if (!claim.ok) {
      await emit("identify", "warn", `Another request is already researching ${id.name}; following it`);
      return { message: `Following the existing job for ${id.name}`, payload: { jobId: claim.activeJob.id } };
    }
    app = existing ?? (await insertApp({ name: id.name, domain: id.domain, developerPortalUrl: id.developerPortalUrl }));
    await setJobApp(job.id, { appId: app.id, domain: app.primary_domain });
    if (n.kind === "name" && slugify(n.name) !== app.slug) await addAliases(app.id, [n.name]);
  }
  if (app.developer_portal_url) knownUrls.add(app.developer_portal_url);
  await emit("identify", "success", `Found ${app.name} (${app.primary_domain}) ✓`, { app: { name: app.name, domain: app.primary_domain, slug: app.slug } });
  throwIfAborted(signal);

  const ctx: AgentContext = { jobId: job.id, app, emit, signal, fetcher: createPageFetcher(3), knownUrls };

  // Step 1 — research
  const { pages, facts } = await researchApp(ctx);
  throwIfAborted(signal);

  // Step 2 — probe
  const probes = await runProbes(ctx, pages, facts);
  throwIfAborted(signal);

  // Step 3 — verify
  const { verified } = facts.length
    ? await verifyFacts(ctx, facts, pages)
    : { verified: [] };
  if (!facts.length) await emit("verify", "warn", "No OAuth facts found on the fetched pages — the guide will say so");
  throwIfAborted(signal);

  // Step 4 — compose + persist
  const { guide, citations } = await composeGuide(ctx, verified, probes, pages);
  await emit("compose", "info", "Saving guide…");
  const sources: SourceLookup = new Map(pages.map((p) => [p.url, { sourceId: p.sourceId, snapshotId: p.snapshotId }]));
  const saved = await saveGuideVersion({ app, guide, sources, citations, jobId: job.id });
  await emit("compose", "success", `Guide written — ${guide.summary.difficulty} (${guide.summary.confidence} confidence) ✓`, {
    section: "guide",
    data: saved.guide,
  });
  return { slug: app.slug };
};
