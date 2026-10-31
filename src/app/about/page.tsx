import type { Metadata } from "next";
import { verificationSummary } from "@/lib/db/claims";
import { configStatus } from "@/server/config-status";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "How guides are made" };

const STEPS = [
  ["Research", "Searches the web for the provider's developer docs, reads the most relevant official pages (community pages are labelled), and extracts candidate facts. A fact is kept only if its quoted excerpt really appears on the page."],
  ["Probe", "Makes read-only, unauthenticated GET requests: OAuth discovery documents, the authorize endpoint with a deliberately invalid client_id, and the developer console (does it require sign-in?). It never logs in, submits forms, or accepts terms."],
  ["Verify", "A second, strict pass checks every fact against the page it came from. Supported facts become Sourced; partially supported ones are corrected; unsupported ones are dropped, or kept as Uncertain when they matter (e.g. review time)."],
  ["Compose", "Writes the guide citing facts and probes by id. Code — not the AI — turns citations into evidence tags and links, removes URLs the agent never saw, and computes difficulty from fixed rules."],
] as const;

const RULES = [
  ["R1", "No self-serve registration, or a partner program/application is required", "Hard"],
  ["R2", "A security assessment is required or may be required", "Hard"],
  ["R3", "Paid plan required (Hard if combined with any review)", "At least Medium"],
  ["R4", "Every app must be reviewed", "At least Medium"],
  ["R5", "Review required for public distribution or sensitive scopes", "At least Medium"],
  ["R6", "Business verification is required", "At least Medium"],
  ["R7", "Some APIs require a partner program or application", "At least Medium"],
  ["R8", "None of the above", "Easy"],
  ["R9", "Three or more requirements could not be confirmed", "Confidence forced to Low"],
] as const;

export default async function AboutPage() {
  const rows = await verificationSummary().catch(() => []);
  const count = (by: string, outcome?: string) =>
    rows.filter((r) => r.verified_by === by && (!outcome || r.outcome === outcome)).reduce((n, r) => n + r.count, 0);
  const human = count("human");
  const cfg = configStatus();
  const keyState = (set: boolean, name: string) => (
    <span className={set ? "text-easy" : "text-hard"}>{set ? `${name} is set` : `${name} is missing`}</span>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-12">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">How guides are made</h1>
        <p className="text-pretty text-muted-foreground">
          Every guide answers “how hard, how long, what do I need, what can block me” — and every claim in it carries
          evidence you can inspect.
        </p>
      </header>

      <section aria-labelledby="pipeline" className="space-y-4">
        <h2 id="pipeline" className="text-lg font-semibold">The agent, in four steps</h2>
        <ol className="space-y-3">
          {STEPS.map(([name, text], i) => (
            <li key={name} className="flex gap-3 rounded-lg border p-4">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">{i + 1}</span>
              <div>
                <h3 className="font-medium">{name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="evidence" className="space-y-4">
        <h2 id="evidence" className="text-lg font-semibold">Evidence tags</h2>
        <dl className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border p-4">
            <dt><span className="rounded-md bg-tested/10 px-1.5 py-0.5 text-xs font-medium text-tested ring-1 ring-inset ring-tested/30">Tested</span></dt>
            <dd className="mt-2 text-sm text-muted-foreground">The agent observed it directly with a probe (endpoint responded, metadata listed scopes, console redirects to sign-in).</dd>
          </div>
          <div className="rounded-lg border p-4">
            <dt><span className="rounded-md bg-sourced/10 px-1.5 py-0.5 text-xs font-medium text-sourced ring-1 ring-inset ring-sourced/30">Sourced</span></dt>
            <dd className="mt-2 text-sm text-muted-foreground">A page the agent fetched states it, and a second pass confirmed the page supports it. The excerpt is shown.</dd>
          </div>
          <div className="rounded-lg border p-4">
            <dt><span className="rounded-md border border-dashed border-uncertain/60 px-1.5 py-0.5 text-xs font-medium text-uncertain">Uncertain</span></dt>
            <dd className="mt-2 text-sm text-muted-foreground">Inferred, conflicting, or not found. The guide says why. Never presented as fact.</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="rules" className="space-y-4">
        <h2 id="rules" className="text-lg font-semibold">Difficulty rules</h2>
        <p className="text-sm text-muted-foreground">Computed in code from the guide&apos;s requirements, so the same evidence always gives the same rating.</p>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr><th scope="col" className="px-3 py-2">Rule</th><th scope="col" className="px-3 py-2">Condition</th><th scope="col" className="px-3 py-2">Effect</th></tr>
            </thead>
            <tbody className="divide-y">
              {RULES.map(([id, cond, effect]) => (
                <tr key={id}><td className="px-3 py-2 font-mono text-xs">{id}</td><td className="px-3 py-2">{cond}</td><td className="px-3 py-2 whitespace-nowrap">{effect}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="setup" className="space-y-4">
        <h2 id="setup" className="text-lg font-semibold">This server&apos;s default setup</h2>
        <p className="text-sm text-muted-foreground">
          Visitors can bring their own keys and choose the provider and model on the{" "}
          <a href="/settings" className="text-tested hover:underline">API keys</a> page; otherwise these server keys are used.
        </p>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-lg border p-4">
            <dt className="font-medium">AI model</dt>
            <dd className="mt-1 text-muted-foreground">
              {cfg.llm.provider === "groq" ? "Groq" : "Anthropic (Claude)"} · <span className="font-mono text-xs">{cfg.llm.model}</span>
            </dd>
            <dd className="mt-1">{keyState(cfg.llm.keySet, cfg.llm.keyName)}</dd>
          </div>
          <div className="rounded-lg border p-4">
            <dt className="font-medium">Web search</dt>
            <dd className="mt-1 text-muted-foreground">Tavily</dd>
            <dd className="mt-1">{keyState(cfg.search.keySet, cfg.search.keyName)}</dd>
          </div>
        </dl>
        <p className="text-sm text-muted-foreground">
          {cfg.canGenerate
            ? "New guides can be generated. If a provider's free allowance runs out, the job page says so and existing guides keep working."
            : "Without your own keys, new guides can't be generated here; the library still works."}
        </p>
      </section>

      <section aria-labelledby="verification" className="space-y-4">
        <h2 id="verification" className="text-lg font-semibold">Spot-check results</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border p-4">
            <h3 className="text-sm font-medium">Agent verification (automatic)</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {count("agent", "confirmed")} confirmed · {count("agent", "corrected")} corrected · {count("agent", "unverifiable")} unverifiable
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <h3 className="text-sm font-medium">Human spot-check</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {human
                ? `${count("human", "confirmed")} confirmed · ${count("human", "corrected")} corrected · ${count("human", "unverifiable")} unverifiable`
                : "Not yet recorded. A developer reviews a sample of claims against live docs; results appear here and in VERIFICATION.md."}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
