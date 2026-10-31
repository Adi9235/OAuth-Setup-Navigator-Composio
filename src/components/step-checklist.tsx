"use client";

import { ChevronDown, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { PHASE_LABEL, PHASES } from "@/lib/format";
import type { Step } from "@/lib/guide-schema";
import { OwnerChip } from "./badges";
import { EvidenceBadge } from "./evidence-badge";
import { FeedbackLink } from "./feedback-link";

const key = (slug: string) => `steps:${slug}`;

function load(slug: string): Set<string> {
  try {
    const raw = localStorage.getItem(key(slug));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/** Steps grouped by phase, with progress saved per guide in localStorage. */
export function StepChecklist({ steps, slug }: { steps: Step[]; slug?: string }) {
  const [done, setDone] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (slug) setDone(load(slug));
  }, [slug]);

  const toggle = (id: string) => {
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (slug) {
        try {
          localStorage.setItem(key(slug), JSON.stringify([...next]));
        } catch {
          // storage unavailable — progress lasts for this visit only
        }
      }
      return next;
    });
  };

  const count = steps.filter((s) => done.has(s.id)).length;
  let n = 0;
  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full rounded-full bg-easy transition-all" style={{ width: `${steps.length ? (count / steps.length) * 100 : 0}%` }} />
        </div>
        <p className="shrink-0 text-xs text-muted-foreground" aria-live="polite">
          {count} of {steps.length} done
        </p>
      </div>
      <div className="space-y-6">
        {PHASES.map((phase) => {
          const group = steps.filter((s) => s.phase === phase);
          if (!group.length) return null;
          return (
            <section key={phase} aria-labelledby={`phase-${phase}`}>
              <h3 id={`phase-${phase}`} className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {PHASE_LABEL[phase]}
              </h3>
              <ol className="divide-y rounded-lg border">
                {group.map((s) => {
                  const num = ++n;
                  const id = `step-${s.id}`;
                  const extra = s.agentCanHelp || s.humanMust;
                  return (
                    <li key={s.id} className="p-3 sm:p-4">
                      <div className="flex gap-3">
                        <input
                          id={id}
                          type="checkbox"
                          checked={done.has(s.id)}
                          onChange={() => toggle(s.id)}
                          className="mt-1 size-4 shrink-0 accent-[var(--easy)]"
                        />
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <label htmlFor={id} className={done.has(s.id) ? "font-medium text-muted-foreground line-through" : "font-medium"}>
                              {num}. {s.title}
                            </label>
                            <OwnerChip owner={s.owner} />
                            <EvidenceBadge claim={s} />
                          </div>
                          <p className="text-sm text-muted-foreground">{s.text}</p>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                            {s.url && (
                              <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-tested hover:underline">
                                Open console <ExternalLink className="size-3" aria-hidden />
                              </a>
                            )}
                            {extra && (
                              <Collapsible>
                                <CollapsibleTrigger className="group inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                                  Who does what <ChevronDown className="size-3 transition-transform group-data-[panel-open]:rotate-180" aria-hidden />
                                </CollapsibleTrigger>
                                <CollapsibleContent className="mt-2 space-y-1 text-sm">
                                  {s.agentCanHelp && <p><span className="font-medium text-agent">Agent can help with:</span> {s.agentCanHelp}</p>}
                                  {s.humanMust && <p><span className="font-medium">You must:</span> {s.humanMust}</p>}
                                </CollapsibleContent>
                              </Collapsible>
                            )}
                            {slug && <FeedbackLink slug={slug} claimId={s.id} />}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
      </div>
    </div>
  );
}
