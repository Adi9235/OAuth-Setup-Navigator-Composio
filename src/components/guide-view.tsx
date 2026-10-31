// Full guide body (UI_SPEC Screen 2). No hooks, so it renders on the server (guide page)
// and inside the client job page alike. Interactive parts are small client components.
import { ArrowRight, ExternalLink, Info } from "lucide-react";
import { formatDays, formatMinutes, SIGNAL_TITLE, SIGNAL_VALUE_LABEL } from "@/lib/format";
import type { Guide } from "@/lib/guide-schema";
import { SIGNAL_KEYS } from "@/lib/guide-schema";
import { allClaims } from "@/server/agent/difficulty";
import { ConfidenceChip, DifficultyBadge } from "./badges";
import { EvidenceBadge, EvidenceProvider } from "./evidence-badge";
import { FreshnessBadge } from "./freshness-badge";
import { ShareBar } from "./share-bar";
import { StepChecklist } from "./step-checklist";

export interface GuideMeta {
  slug: string;
  versionNo: number;
  freshness: "fresh" | "rechecking" | "outdated";
  lastVerifiedAt: string | null;
  versions: { no: number; created_at: string; change_summary: string | null; created_by: string }[];
}

function Section({ id, title, children, hint }: { id: string; title: string; children: React.ReactNode; hint?: string }) {
  return (
    <section aria-labelledby={id} className="scroll-mt-20">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id={id} className="text-lg font-semibold tracking-tight">{title}</h2>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
      {sub && <dd className="text-xs text-muted-foreground">{sub}</dd>}
    </div>
  );
}

export function GuideHeader({ guide, meta }: { guide: Guide; meta?: GuideMeta }) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{guide.app.name}</h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
          <span>{guide.app.domain}</span>
          {meta && <FreshnessBadge freshness={meta.freshness} lastVerifiedAt={meta.lastVerifiedAt} />}
          <ConfidenceChip confidence={guide.summary.confidence} />
        </div>
      </div>
      {meta && <ShareBar slug={meta.slug} />}
    </header>
  );
}

export function SummaryCard({ guide }: { guide: Guide }) {
  const s = guide.summary;
  const waitClaim = guide.gotchas.find((g) => g.id.startsWith("timing")) ?? null;
  return (
    <div className="rounded-xl border bg-card p-4 shadow-xs sm:p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="shrink-0">
          <p className="mb-1 text-xs text-muted-foreground">Difficulty</p>
          <DifficultyBadge difficulty={s.difficulty} size="lg" />
        </div>
        <dl className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-3 sm:border-l sm:pl-6">
          <Stat label="Hands-on time" value={formatMinutes(s.handsOnMinutes)} sub="estimate" />
          <Stat
            label="Approval wait"
            value={formatDays(s.approvalWaitDays)}
            sub={waitClaim ? <span className="inline-flex items-center gap-1">placeholder <EvidenceBadge claim={waitClaim} /></span> : undefined}
          />
          <Stat label="Cost" value={s.costNote ? (s.costNote.length > 24 ? "See note" : s.costNote) : "Not stated"} sub={s.costNote && s.costNote.length > 24 ? s.costNote : undefined} />
        </dl>
      </div>
      <p className="mt-5 text-pretty text-base">{s.oneLiner}</p>
      <details className="group mt-4">
        <summary className="cursor-pointer select-none text-sm font-medium text-muted-foreground hover:text-foreground">
          Why this rating
        </summary>
        <ul className="mt-2 space-y-1 text-sm">
          {s.difficultyReasons.map((r) => {
            const [rule, ...rest] = r.split(": ");
            return (
              <li key={r} className="flex gap-2">
                <span className="w-7 shrink-0 font-mono text-xs leading-5 text-muted-foreground">{rule}</span>
                <span>{rest.join(": ") || r}</span>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">Computed by fixed rules from the requirements below — not chosen by the AI.</p>
      </details>
    </div>
  );
}

function NoOAuthNotice({ guide }: { guide: Guide }) {
  if (guide.app.oauthSupported === "yes") return null;
  const no = guide.app.oauthSupported === "no";
  return (
    <div role="status" className="flex gap-3 rounded-xl border border-uncertain/50 bg-uncertain/5 p-4">
      <Info className="mt-0.5 size-5 shrink-0 text-uncertain" aria-hidden />
      <div className="space-y-1 text-sm">
        <p className="font-medium">{no ? `No public OAuth found for ${guide.app.name}` : `Couldn't confirm public OAuth for ${guide.app.name}`}</p>
        <p className="text-muted-foreground">
          The agent read {guide.sources.length} page{guide.sources.length === 1 ? "" : "s"} and ran {guide.probes.length} probe
          {guide.probes.length === 1 ? "" : "s"} (listed below). Check whether the provider offers API keys, personal access
          tokens, or a partner program instead.
        </p>
      </div>
    </div>
  );
}

function NextAction({ guide }: { guide: Guide }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-tested/40 bg-tested/5 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex gap-3">
        <ArrowRight className="mt-0.5 size-5 shrink-0 text-tested" aria-hidden />
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-tested">Start here</p>
          <p className="mt-0.5 text-pretty">{guide.nextAction}</p>
        </div>
      </div>
      {guide.app.developerPortalUrl && (
        <a
          href={guide.app.developerPortalUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90 sm:self-center"
        >
          Open developer portal <ExternalLink className="size-3.5" aria-hidden />
        </a>
      )}
    </div>
  );
}

function OwnerSplit({ guide }: { guide: Guide }) {
  const col = (title: string, items: string[], accent: string) => (
    <div className="rounded-lg border p-4">
      <h3 className={`mb-2 text-sm font-semibold ${accent}`}>{title}</h3>
      {items.length ? (
        <ul className="space-y-1.5 text-sm">
          {items.map((x) => (
            <li key={x} className="flex gap-2"><span aria-hidden className="text-muted-foreground">–</span>{x}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing listed.</p>
      )}
    </div>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {col("An agent can do", guide.agentVsHuman.agentCan, "text-agent")}
      {col("You must do", guide.agentVsHuman.youMust, "")}
    </div>
  );
}

function Requirements({ guide }: { guide: Guide }) {
  return (
    <div className="space-y-5">
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {SIGNAL_KEYS.map((k) => {
          const sig = guide.signals[k];
          return (
            <div key={k} className="flex items-start justify-between gap-3 border-b pb-2.5">
              <div className="min-w-0">
                <dt className="text-sm font-medium">{SIGNAL_TITLE[k]}</dt>
                <dd className="text-xs text-muted-foreground">{sig.text}</dd>
              </div>
              <dd className="flex shrink-0 flex-col items-end gap-1">
                <span className={`text-sm ${sig.value === "unclear" ? "text-uncertain" : ""}`}>{SIGNAL_VALUE_LABEL[sig.value] ?? sig.value}</span>
                <EvidenceBadge claim={sig} />
              </dd>
            </div>
          );
        })}
      </dl>
      {guide.prerequisites.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Have these ready</h3>
          <ul className="space-y-2">
            {guide.prerequisites.map((p) => (
              <li key={p.id} className="flex items-start gap-2 text-sm">
                <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground" />
                <span className="flex-1">{p.text}</span>
                <EvidenceBadge claim={p} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ScopeTable({ guide }: { guide: Guide }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Scope</th>
            <th scope="col" className="px-3 py-2 font-medium">Tier</th>
            <th scope="col" className="px-3 py-2 font-medium">What it&apos;s for</th>
            <th scope="col" className="px-3 py-2 font-medium">Evidence</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {guide.scopes.map((s) => (
            <tr key={s.id}>
              <td className="px-3 py-2 font-mono text-xs">{s.scope}</td>
              <td className={`px-3 py-2 ${s.tier === "restricted" ? "text-hard" : s.tier === "sensitive" ? "text-medium" : ""}`}>{s.tier}</td>
              <td className="px-3 py-2 text-muted-foreground">{s.text}</td>
              <td className="px-3 py-2"><EvidenceBadge claim={s} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Gotchas({ guide }: { guide: Guide }) {
  const gotchas = guide.gotchas.filter((g) => !g.id.startsWith("timing"));
  return (
    <div className="space-y-3">
      {guide.blockers.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {guide.blockers.map((b) => (
            <li key={b.problem} className="rounded-lg border p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">{b.problem}</p>
                <EvidenceBadge claim={b} />
              </div>
              <p className="mt-1.5 text-muted-foreground"><span className="font-medium text-easy">Fix:</span> {b.fix}</p>
            </li>
          ))}
        </ul>
      )}
      {gotchas.length > 0 && (
        <ul className="space-y-2">
          {gotchas.map((g) => (
            <li key={g.id} className="flex items-start gap-2 text-sm">
              <span aria-hidden className="mt-0.5 text-medium">!</span>
              <span className="flex-1">{g.text}</span>
              <EvidenceBadge claim={g} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function EvidenceMixBar({ guide }: { guide: Guide }) {
  const claims = allClaims(guide);
  const mix = { tested: 0, sourced: 0, uncertain: 0 };
  for (const c of claims) mix[c.evidence]++;
  const total = claims.length || 1;
  const parts: [keyof typeof mix, string][] = [["sourced", "bg-sourced"], ["tested", "bg-tested"], ["uncertain", "bg-uncertain"]];
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${mix.sourced} sourced, ${mix.tested} tested, ${mix.uncertain} uncertain`}>
        {parts.map(([k, cls]) => <div key={k} className={cls} style={{ width: `${(mix[k] / total) * 100}%` }} />)}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {mix.sourced} sourced · {mix.tested} tested · {mix.uncertain} uncertain
      </p>
    </div>
  );
}

function SourcesAndProbes({ guide }: { guide: Guide }) {
  return (
    <div className="space-y-6">
      <EvidenceMixBar guide={guide} />
      <div>
        <h3 className="mb-2 text-sm font-semibold">Pages read ({guide.sources.length})</h3>
        <ul className="space-y-1.5 text-sm">
          {guide.sources.map((s) => (
            <li key={s.url} className="flex flex-wrap items-baseline gap-x-2">
              <a href={s.url} target="_blank" rel="noreferrer" className="break-all text-tested hover:underline">{s.title ?? s.url}</a>
              <span className="text-xs text-muted-foreground">{s.official ? "official" : "community source"} · fetched {s.fetchedAt.slice(0, 10)}</span>
            </li>
          ))}
        </ul>
      </div>
      {guide.probes.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Probes run ({guide.probes.length})</h3>
          <p className="mb-2 text-xs text-muted-foreground">Read-only, unauthenticated GET requests. The agent never logs in or submits forms.</p>
          <ul className="space-y-2 text-sm">
            {guide.probes.map((p) => (
              <li key={p.id} className="flex gap-2">
                <span className={`mt-0.5 w-10 shrink-0 font-mono text-xs ${p.outcome === "pass" ? "text-easy" : p.outcome === "fail" ? "text-muted-foreground" : "text-hard"}`}>{p.outcome}</span>
                <span className="min-w-0 break-words">
                  <span className="font-medium">{p.type.replace(/_/g, " ")}</span> — <span className="text-muted-foreground">{p.summary}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function VersionHistory({ versions }: { versions: GuideMeta["versions"] }) {
  return (
    <ol className="space-y-2 text-sm">
      {versions.map((v) => (
        <li key={v.no} className="flex flex-wrap gap-x-3">
          <span className="font-mono text-xs leading-5 text-muted-foreground">v{v.no}</span>
          <time dateTime={v.created_at} title={v.created_at} className="text-muted-foreground">{v.created_at.slice(0, 10)}</time>
          <span>{v.change_summary ?? (v.no === 1 ? "First version" : "Updated")}</span>
          {v.created_by === "human" && <span className="text-xs text-muted-foreground">(human edit)</span>}
        </li>
      ))}
    </ol>
  );
}

export function GuideView({ guide, meta }: { guide: Guide; meta?: GuideMeta }) {
  return (
    <EvidenceProvider guide={guide}>
      <article className="space-y-10">
        <div className="space-y-5">
          <GuideHeader guide={guide} meta={meta} />
          <NoOAuthNotice guide={guide} />
          <SummaryCard guide={guide} />
          <NextAction guide={guide} />
        </div>
        <Section id="who" title="Who does what"><OwnerSplit guide={guide} /></Section>
        <Section id="requirements" title="Before you start" hint="Tap a badge to see the evidence"><Requirements guide={guide} /></Section>
        <Section id="steps" title="Steps"><StepChecklist steps={guide.steps} slug={meta?.slug} /></Section>
        {guide.scopes.length > 0 && <Section id="scopes" title="Scopes"><ScopeTable guide={guide} /></Section>}
        {(guide.blockers.length > 0 || guide.gotchas.some((g) => !g.id.startsWith("timing"))) && (
          <Section id="gotchas" title="Gotchas & blockers"><Gotchas guide={guide} /></Section>
        )}
        <Section id="open-questions" title="Open questions">
          {guide.openQuestions.length ? (
            <ul className="space-y-1.5 text-sm">
              {guide.openQuestions.map((q) => (
                <li key={q} className="flex gap-2"><span aria-hidden className="text-uncertain">?</span>{q}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">None — every requirement was confirmed.</p>
          )}
        </Section>
        <Section id="evidence" title="Evidence & sources"><SourcesAndProbes guide={guide} /></Section>
        {meta && meta.versions.length > 0 && <Section id="versions" title="Version history"><VersionHistory versions={meta.versions} /></Section>}
      </article>
    </EvidenceProvider>
  );
}
