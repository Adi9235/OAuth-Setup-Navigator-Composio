// Persist a composed guide: version + claims + claim_sources + verification_log, in one transaction.
// Claim ids inside the stored JSON are replaced with their DB uuids (for feedback links).
import type { AppRow } from "@/lib/db/apps";
import { insertClaim, insertClaimSource, insertVerificationLog, type ClaimSection } from "@/lib/db/claims";
import { getOrCreateGuide, insertGuideVersion, publishVersion, setVersionContent } from "@/lib/db/guides";
import { withTx } from "@/lib/db/pool";
import type { Claim, Guide, SignalKey } from "@/lib/guide-schema";
import { SIGNAL_KEYS } from "@/lib/guide-schema";
import type { Resolver } from "./compose";

const SIGNAL_SECTION: Record<SignalKey, ClaimSection> = {
  selfServeRegistration: "requirement",
  reviewRequired: "approval",
  securityAssessment: "approval",
  partnerOrApplication: "requirement",
  paidPlanRequired: "cost",
  businessVerification: "requirement",
  domainOrPrivacyPolicy: "requirement",
};

export type SourceLookup = Map<string, { sourceId: string; snapshotId: string | null }>;

interface ClaimSlot {
  claim: Claim;
  section: ClaimSection;
  position: number;
  owner?: "agent" | "you" | "both";
  assign: (id: string) => void;
}

/** Every Claim in the guide with its DB section and a setter for its id. Mutates `guide` via assign. */
export function claimSlots(guide: Guide): ClaimSlot[] {
  const slots: ClaimSlot[] = [];
  SIGNAL_KEYS.forEach((k, i) => slots.push({ claim: guide.signals[k], section: SIGNAL_SECTION[k], position: i, assign: (id) => (guide.signals[k].id = id) }));
  guide.prerequisites.forEach((c, i) => slots.push({ claim: c, section: "requirement", position: 100 + i, assign: (id) => (c.id = id) }));
  guide.steps.forEach((c, i) => slots.push({ claim: c, section: "step", position: i, owner: c.owner, assign: (id) => (c.id = id) }));
  guide.scopes.forEach((c, i) => slots.push({ claim: c, section: "scope", position: i, assign: (id) => (c.id = id) }));
  guide.gotchas.forEach((c, i) =>
    slots.push({ claim: c, section: c.id.startsWith("timing") ? "timing" : "blocker", position: i, assign: (id) => (c.id = id) }));
  return slots;
}

export async function saveGuideVersion(input: {
  app: AppRow;
  guide: Guide;
  sources: SourceLookup;
  citations?: Resolver["citations"];
  jobId?: string | null;
  changeSummary?: string;
  createdBy?: "agent" | "human";
}): Promise<{ versionId: string; versionNo: number; guide: Guide }> {
  const guide = structuredClone(input.guide);
  return withTx(async (tx) => {
    const g = await getOrCreateGuide(input.app.id, tx);
    const version = await insertGuideVersion(
      { guideId: g.id, content: guide, changeSummary: input.changeSummary, createdBy: input.createdBy, jobId: input.jobId },
      tx,
    );
    for (const slot of claimSlots(guide)) {
      const tempId = slot.claim.id;
      const id = await insertClaim(
        {
          versionId: version.id, section: slot.section, position: slot.position, text: slot.claim.text, owner: slot.owner,
          evidence: slot.claim.evidence, probeRunId: slot.claim.evidence === "tested" ? slot.claim.probeId : null,
        },
        tx,
      );
      for (const s of slot.claim.sources) {
        const src = input.sources.get(s.url);
        if (src) await insertClaimSource({ claimId: id, sourceId: src.sourceId, snapshotId: src.snapshotId, excerpt: s.excerpt }, tx);
      }
      const cite = input.citations?.get(tempId);
      const fact = cite?.facts[0];
      if (slot.claim.evidence === "tested") {
        await insertVerificationLog({ claimId: id, verifiedBy: "agent", method: "probe", outcome: "confirmed", note: cite?.probe?.summary }, tx);
      } else if (fact) {
        await insertVerificationLog(
          {
            claimId: id, verifiedBy: "agent", method: "doc_review",
            outcome: slot.claim.evidence === "uncertain" ? "unverifiable" : fact.verdict === "partially" ? "corrected" : "confirmed",
            originalText: fact.originalText ?? null, correctedText: fact.originalText ? fact.text : null, note: fact.reason,
          },
          tx,
        );
      }
      slot.assign(id);
    }
    await setVersionContent(version.id, guide, tx);
    await publishVersion(g.id, version.id, tx);
    return { versionId: version.id, versionNo: version.version_no, guide };
  });
}
