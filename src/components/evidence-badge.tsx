"use client";

import { createContext, useContext } from "react";
import { cn } from "cn";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Evidence, Guide, SourceRef } from "@/lib/guide-schema";

interface EvidenceLookup {
  probes: Guide["probes"];
  sources: Guide["sources"];
}
const EvidenceContext = createContext<EvidenceLookup>({ probes: [], sources: [] });

export function EvidenceProvider({ guide, children }: { guide: Pick<Guide, "probes" | "sources">; children: React.ReactNode }) {
  return <EvidenceContext.Provider value={{ probes: guide.probes, sources: guide.sources }}>{children}</EvidenceContext.Provider>;
}

const STYLE: Record<Evidence, string> = {
  tested: "text-tested bg-tested/10 ring-1 ring-inset ring-tested/30",
  sourced: "text-sourced bg-sourced/10 ring-1 ring-inset ring-sourced/30",
  uncertain: "text-uncertain bg-uncertain/5 border border-dashed border-uncertain/60",
};
const LABEL: Record<Evidence, string> = { tested: "Tested", sourced: "Sourced", uncertain: "Uncertain" };

export interface EvidenceLike {
  evidence: Evidence;
  sources?: SourceRef[];
  probeId?: string;
  uncertaintyNote?: string;
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function EvidenceBadge({ claim, className }: { claim: EvidenceLike; className?: string }) {
  const { probes, sources } = useContext(EvidenceContext);
  const probe = claim.probeId ? probes.find((p) => p.id === claim.probeId) : undefined;
  const official = (url: string) => sources.find((s) => s.url === url)?.official ?? true;

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        aria-label={`Evidence: ${LABEL[claim.evidence]} — show details`}
        className={cn(
          "inline-flex shrink-0 cursor-pointer items-center rounded-md px-1.5 py-0.5 align-middle text-[11px] font-medium leading-none outline-none focus-visible:ring-2 focus-visible:ring-ring",
          STYLE[claim.evidence],
          className,
        )}
      >
        {LABEL[claim.evidence]}
      </PopoverTrigger>
      <PopoverContent className="w-80 max-w-[calc(100vw-2rem)] text-xs" side="top">
        {claim.evidence === "tested" && (
          <div className="space-y-1.5">
            <p className="font-medium text-tested">Tested by a probe the agent ran</p>
            {probe ? (
              <>
                <p className="text-muted-foreground">
                  {probe.type.replace(/_/g, " ")} · {probe.outcome}
                </p>
                <p className="break-words">{probe.summary}</p>
              </>
            ) : (
              <p className="text-muted-foreground">Probe details unavailable.</p>
            )}
          </div>
        )}
        {claim.evidence === "uncertain" && (
          <div className="space-y-1.5">
            <p className="font-medium text-uncertain">Not confirmed</p>
            <p>{claim.uncertaintyNote ?? "No fetched page or probe confirmed this."}</p>
            {!!claim.sources?.length && <p className="text-muted-foreground">Related page: {hostOf(claim.sources[0].url)}</p>}
          </div>
        )}
        {(claim.evidence === "sourced" || (claim.evidence === "tested" && !!claim.sources?.length)) && (
          <ul className={cn("space-y-2.5", claim.evidence === "tested" && "mt-2 border-t pt-2")}>
            {claim.evidence === "sourced" && <li className="font-medium">Stated by {claim.sources?.length === 1 ? "this page" : "these pages"}</li>}
            {claim.sources?.map((s) => (
              <li key={s.url} className="space-y-1">
                <a href={s.url} target="_blank" rel="noreferrer" className="block break-all font-medium text-tested underline-offset-2 hover:underline">
                  {s.title ?? hostOf(s.url)}
                </a>
                <span className="text-muted-foreground">
                  {hostOf(s.url)}
                  {!official(s.url) && " · community source"}
                </span>
                {s.excerpt && <blockquote className="border-l-2 pl-2 italic text-muted-foreground">“{s.excerpt}”</blockquote>}
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
