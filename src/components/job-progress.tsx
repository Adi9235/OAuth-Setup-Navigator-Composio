"use client";

import { Check, ChevronDown, Circle, ExternalLink, KeyRound, Loader2, RotateCcw, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { JOB_STEPS, type JobEvent, type JobSummary } from "@/lib/api-types";
import { formatWait, type ErrorExplanation } from "@/lib/service-error";
import { formatMinutes, OWNER_LABEL, PHASE_LABEL } from "@/lib/format";
import { GuideSchema, type Guide } from "@/lib/guide-schema";
import { credentialsPayload } from "./api-settings";
import { DifficultyBadge } from "./badges";
import { GuideView } from "./guide-view";
import { useJobEvents } from "./use-job-events";

const STEP_LABEL: Record<string, string> = {
  identify: "Identify the app",
  research: "Search & read developer docs",
  probe: "Check OAuth endpoints",
  verify: "Verify facts against sources",
  compose: "Write the guide",
  fetch: "Re-fetch sources and compare",
  recheck: "Re-fetch sources and compare",
};

type StepState = "pending" | "active" | "done" | "error";

function useElapsed(startIso: string, stopped: boolean) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    if (stopped) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [stopped]);
  if (now === null) return "0:00";
  const s = Math.max(0, Math.floor((now - new Date(startIso).getTime()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function StepIcon({ state }: { state: StepState }) {
  if (state === "done") return <Check className="size-4 text-easy" aria-hidden />;
  if (state === "active") return <Loader2 className="size-4 animate-spin text-tested" aria-hidden />;
  if (state === "error") return <X className="size-4 text-hard" aria-hidden />;
  return <Circle className="size-3.5 text-muted-foreground/50" aria-hidden />;
}

interface Preview {
  summary?: { oneLiner: string; difficulty: Guide["summary"]["difficulty"]; handsOnMinutes: Guide["summary"]["handsOnMinutes"]; nextAction: string };
  steps?: { title: string; owner: keyof typeof OWNER_LABEL; phase: keyof typeof PHASE_LABEL }[];
  guide?: Guide;
}

function previewFrom(events: JobEvent[]): Preview {
  const p: Preview = {};
  for (const e of events) {
    const section = e.payload?.section;
    const data = e.payload?.data;
    if (section === "summary") p.summary = data as Preview["summary"];
    if (section === "steps") p.steps = (data as { steps: Preview["steps"] }).steps;
    if (section === "guide") {
      const parsed = GuideSchema.safeParse(data);
      if (parsed.success) p.guide = parsed.data;
    }
  }
  return p;
}

// Configuration problems won't fix themselves on retry — say what to change instead.
const CONFIG_CODES = new Set(["missing_key", "invalid_key", "no_credit", "model_not_found"]);

function JobFailure({ explanation: x, onRetry, retrying, retryError }: { explanation: ErrorExplanation; onRetry: () => void; retrying: boolean; retryError: string }) {
  const config = CONFIG_CODES.has(x.code);
  const service = x.code === "quota_exhausted" || x.code === "rate_limited";
  return (
    <div role="alert" className={cn("mt-4 space-y-3 rounded-xl border p-4", service ? "border-uncertain/50 bg-uncertain/5" : "border-hard/40 bg-hard/5")}>
      <div className="space-y-1">
        <p className="font-medium">{x.title}</p>
        {x.detail && <p className="text-sm text-muted-foreground">{x.detail}</p>}
        {x.hint && <p className="text-sm"><span className="font-medium">What to do:</span> {x.hint}</p>}
        {service && <p className="text-xs text-muted-foreground">Existing guides in the library still work.</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {(config || service) && (
          <Button size="sm" nativeButton={false} render={<Link href="/settings" />}>
            <KeyRound aria-hidden /> {config ? "Fix in Settings" : "Use your own key"}
          </Button>
        )}
        {!config && (
          <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
            <RotateCcw aria-hidden className={retrying ? "animate-spin" : ""} />
            {x.retryAfterSec && x.retryAfterSec > 60 ? `Try again (wait ~${formatWait(x.retryAfterSec)})` : "Try again"}
          </Button>
        )}
      </div>
      {retryError && <p className="text-sm text-hard">{retryError}</p>}
    </div>
  );
}

export function JobProgress({ job }: { job: JobSummary }) {
  const router = useRouter();
  const { events, final, connection } = useJobEvents(job.id);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");
  const [copied, setCopied] = useState(false);

  const status = final?.status ?? (events.some((e) => e.step === "done") ? "succeeded" : events.some((e) => e.level === "error") ? "failed" : job.status);
  const done = events.find((e) => e.step === "done");
  const slug = done?.payload?.slug as string | undefined;
  const followJobId = done?.payload?.jobId as string | undefined;
  const errorEvent = [...events].reverse().find((e) => e.level === "error");
  const elapsed = useElapsed(job.startedAt ?? job.createdAt, status === "succeeded" || status === "failed");
  const identified = events.find((e) => e.step === "identify" && e.payload?.app)?.payload?.app as { name?: string; slug?: string } | undefined;
  const appName = identified?.name;
  const appSlug = slug ?? identified?.slug;

  // Another job was already researching the same app: follow it.
  useEffect(() => {
    if (followJobId && followJobId !== job.id) router.replace(`/jobs/${followJobId}`);
  }, [followJobId, job.id, router]);

  const steps = useMemo(() => {
    const names = job.jobType !== "recheck" ? [...JOB_STEPS] : [...new Set(events.map((e) => e.step).filter((s) => s !== "done" && s !== "error"))];
    const lastIdx = Math.max(-1, ...events.filter((e) => e.step !== "done").map((e) => names.indexOf(e.step)));
    return names.map((name, i) => {
      const mine = events.filter((e) => e.step === name);
      const latest = mine[mine.length - 1];
      let state: StepState = "pending";
      if (mine.some((e) => e.level === "error")) state = "error";
      else if (status === "succeeded" && mine.length) state = "done";
      else if (i < lastIdx) state = "done";
      else if (i === lastIdx) state = status === "failed" ? "error" : "active";
      return { name, state, latest, warnings: mine.filter((e) => e.level === "warn") };
    });
  }, [events, job.jobType, status]);

  const preview = useMemo(() => previewFrom(events), [events]);

  const retry = async () => {
    setRetrying(true);
    try {
      const url = job.jobType === "recheck" && appSlug ? `/api/guides/${appSlug}/recheck` : "/api/jobs";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: job.inputText, credentials: credentialsPayload() }),
      });
      const data = (await res.json()) as { jobId?: string; error?: string };
      if (data.jobId) router.push(`/jobs/${data.jobId}`);
      else {
        setRetryError(data.error ?? "Couldn't start again");
        setRetrying(false);
      }
    } catch {
      setRetryError("Couldn't reach the server");
      setRetrying(false);
    }
  };

  const copyLink = async () => {
    if (!slug) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/guides/${slug}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const title = job.jobType === "recheck" ? `Re-checking ${appName ?? job.inputText}` : `Researching ${appName ?? job.inputText}`;

  return (
    <div className="space-y-8">
      <div className="mx-auto max-w-2xl">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {status === "succeeded" ? (job.jobType === "recheck" ? "Re-check finished" : "Guide ready") : status === "failed" ? "Couldn't finish this guide" : `${title}…`}
          </h1>
          <span className="shrink-0 font-mono text-sm tabular-nums text-muted-foreground" aria-label={`Elapsed ${elapsed}`}>{elapsed}</span>
        </div>

        <ol aria-live="polite" aria-label="Progress" className="divide-y rounded-xl border">
          {steps.map((s) => (
            <li key={s.name} className="flex gap-3 p-3 sm:p-4">
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center"><StepIcon state={s.state} /></span>
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm font-medium", s.state === "pending" && "text-muted-foreground")}>{STEP_LABEL[s.name] ?? s.name}</p>
                {s.latest && <p className={cn("mt-0.5 text-sm", s.latest.level === "error" ? "text-hard" : "text-muted-foreground")}>{s.latest.message}</p>}
                {s.warnings.map((w) => (
                  <p key={w.id} className="mt-1 flex items-start gap-1.5 text-sm text-uncertain">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {w.message}
                  </p>
                ))}
              </div>
            </li>
          ))}
        </ol>

        {connection === "lost" && status !== "succeeded" && status !== "failed" && (
          <p className="mt-2 text-xs text-muted-foreground">Connection interrupted — reconnecting…</p>
        )}

        {status === "failed" && (
          <JobFailure
            explanation={(errorEvent?.payload?.error as ErrorExplanation | undefined) ?? {
              code: "internal",
              title: errorEvent?.message ?? "The job failed",
              detail: final?.error ?? "",
            }}
            onRetry={retry}
            retrying={retrying}
            retryError={retryError}
          />
        )}

        {status === "succeeded" && slug && (
          <div className="mt-4 flex flex-col gap-3 rounded-xl border border-easy/40 bg-easy/5 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-medium">{done?.message ?? "Guide ready"}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" nativeButton={false} render={<Link href={`/guides/${slug}`} />}>
                Open shareable page <ExternalLink aria-hidden />
              </Button>
              <Button size="sm" variant="outline" onClick={copyLink}>{copied ? "Copied" : "Copy link"}</Button>
            </div>
          </div>
        )}

        <Collapsible className="mt-4">
          <CollapsibleTrigger className="group inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            Live log ({events.length}) <ChevronDown className="size-3.5 transition-transform group-data-[panel-open]:rotate-180" aria-hidden />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ol className="mt-2 max-h-72 space-y-0.5 overflow-auto rounded-lg border bg-muted/30 p-3 font-mono text-xs">
              {events.map((e) => (
                <li key={e.id} className={e.level === "error" ? "text-hard" : e.level === "warn" ? "text-uncertain" : ""}>
                  <span className="text-muted-foreground">{e.createdAt.slice(11, 19)} [{e.step}]</span> {e.message}
                </li>
              ))}
            </ol>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Progressive preview: summary, then steps, then the full guide. */}
      {preview.guide ? (
        <div className="border-t pt-8"><GuideView guide={preview.guide} /></div>
      ) : (preview.summary || preview.steps) && (
        <div className="mx-auto max-w-2xl space-y-4 border-t pt-8" aria-live="polite">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Preview (still being verified)</p>
          {preview.summary && (
            <div className="rounded-xl border p-4">
              <div className="flex flex-wrap items-center gap-3">
                <DifficultyBadge difficulty={preview.summary.difficulty} />
                <span className="text-sm text-muted-foreground">{formatMinutes(preview.summary.handsOnMinutes)} hands-on</span>
              </div>
              <p className="mt-2">{preview.summary.oneLiner}</p>
            </div>
          )}
          {preview.steps && (
            <ol className="space-y-1 rounded-xl border p-4 text-sm">
              {preview.steps.map((s, i) => (
                <li key={`${s.title}-${i}`} className="flex gap-2">
                  <span className="text-muted-foreground">{i + 1}.</span> {s.title}
                  <span className="text-xs text-muted-foreground">· {PHASE_LABEL[s.phase]} · {OWNER_LABEL[s.owner]}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
