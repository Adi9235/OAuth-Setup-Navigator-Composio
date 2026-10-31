"use client";

import { Check, Eye, EyeOff, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import type { ErrorExplanation } from "@/lib/service-error";
import {
  clearSettings, credentialsPayload, EMPTY_SETTINGS, loadSettings, MODEL_PRESETS, PROVIDER_LABEL, saveSettings,
  useServerConfig, type ApiSettings, type ProviderId,
} from "./api-settings";

interface CheckResult {
  ok: boolean;
  usingServerKey: boolean;
  error?: ErrorExplanation;
  provider?: string;
  model?: string;
}

const PROVIDERS: { id: ProviderId; title: string; blurb: string; keyField: "groqKey" | "anthropicKey"; keyLabel: string; placeholder: string; getKey: string }[] = [
  {
    id: "groq", title: "Groq", blurb: "Free tier. Slower and lighter research (rate-limited), good for trying it out.",
    keyField: "groqKey", keyLabel: "Groq API key", placeholder: "gsk_…", getKey: "https://console.groq.com/keys",
  },
  {
    id: "anthropic", title: "Anthropic (Claude)", blurb: "Paid (needs account credit). Reads more pages and runs faster.",
    keyField: "anthropicKey", keyLabel: "Anthropic API key", placeholder: "sk-ant-…", getKey: "https://console.anthropic.com/settings/keys",
  },
];

function SecretInput({ id, value, onChange, placeholder, describedBy }: { id: string; value: string; onChange: (v: string) => void; placeholder: string; describedBy?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        aria-describedby={describedBy}
        className="h-10 w-full rounded-lg border bg-background pl-3 pr-10 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide key" : "Show key"}
        className="absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:text-foreground"
      >
        {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  );
}

function CheckLine({ label, result }: { label: string; result?: CheckResult }) {
  if (!result) return null;
  if (result.ok)
    return (
      <p className="flex items-center gap-2 text-sm text-easy">
        <Check className="size-4" aria-hidden /> {label} works{result.usingServerKey ? " (using the server's key)" : ""}
        {result.model ? <span className="font-mono text-xs text-muted-foreground">· {result.model}</span> : null}
      </p>
    );
  const e = result.error;
  return (
    <div className="rounded-lg border border-hard/40 bg-hard/5 p-3 text-sm">
      <p className="flex items-center gap-2 font-medium"><TriangleAlert className="size-4 text-hard" aria-hidden /> {label}: {e?.title ?? "failed"}</p>
      {e?.detail && <p className="mt-1 text-muted-foreground">{e.detail}</p>}
      {e?.hint && <p className="mt-1">{e.hint}</p>}
    </div>
  );
}

export function SettingsForm() {
  const server = useServerConfig();
  const [form, setForm] = useState<ApiSettings>(EMPTY_SETTINGS);
  const [hadSaved, setHadSaved] = useState(false);
  const [customModel, setCustomModel] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState<{ llm?: CheckResult; search?: CheckResult; error?: string } | null>(null);
  const ids = { model: useId(), llm: useId(), tavily: useId(), llmHint: useId(), tavilyHint: useId() };

  const [touched, setTouched] = useState(false);

  // Load saved settings once.
  useEffect(() => {
    const s = loadSettings();
    if (!s) return;
    setForm(s);
    setHadSaved(true);
    setCustomModel(!!s.model && !MODEL_PRESETS[s.provider].some((m) => m.id === s.model));
  }, []);

  // With nothing saved, default to the server's provider — but never override what the visitor picked.
  useEffect(() => {
    if (server && !hadSaved && !touched) setForm((f) => ({ ...f, provider: server.llm.provider }));
  }, [server, hadSaved, touched]);

  const update = (patch: Partial<ApiSettings>) => {
    setTouched(true);
    setForm((f) => ({ ...f, ...patch }));
    setSaved(false);
    setResults(null);
  };
  const p = PROVIDERS.find((x) => x.id === form.provider)!;
  const serverHas = (k: "groq" | "anthropic" | "tavily") => !!server?.keys?.[k];

  const test = async () => {
    setTesting(true);
    setResults(null);
    try {
      const res = await fetch("/api/settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentials: credentialsPayload(form) }),
      });
      const data = (await res.json()) as { llm?: CheckResult; search?: CheckResult; error?: string };
      setResults(res.ok ? data : { error: data.error ?? "Test failed" });
    } catch {
      setResults({ error: "Couldn't reach the server" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <form
      className="space-y-8"
      onSubmit={(e) => {
        e.preventDefault();
        saveSettings(form);
        setHadSaved(true);
        setSaved(true);
      }}
    >
      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-semibold">AI provider</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {PROVIDERS.map((opt) => (
            <label
              key={opt.id}
              className={cn(
                "flex cursor-pointer gap-3 rounded-xl border p-4 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                form.provider === opt.id ? "border-foreground/40 bg-muted/50" : "hover:border-foreground/20",
              )}
            >
              <input
                type="radio"
                name="provider"
                value={opt.id}
                checked={form.provider === opt.id}
                onChange={() => {
                  update({ provider: opt.id, model: "" });
                  setCustomModel(false);
                }}
                className="mt-1 accent-[var(--foreground)]"
              />
              <span>
                <span className="block font-medium">{opt.title}</span>
                <span className="mt-0.5 block text-sm text-muted-foreground">{opt.blurb}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="space-y-2">
        <label htmlFor={ids.model} className="text-sm font-semibold">Model</label>
        <select
          id={ids.model}
          value={customModel ? "__custom" : form.model}
          onChange={(e) => {
            const v = e.target.value;
            setCustomModel(v === "__custom");
            update({ model: v === "__custom" ? "" : v });
          }}
          className="h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Default ({MODEL_PRESETS[form.provider][0].id})</option>
          {MODEL_PRESETS[form.provider].map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          <option value="__custom">Other model…</option>
        </select>
        {customModel && (
          <input
            aria-label="Custom model name"
            value={form.model}
            onChange={(e) => update({ model: e.target.value })}
            placeholder={form.provider === "groq" ? "e.g. llama-3.3-70b-versatile" : "e.g. claude-sonnet-5-5"}
            className="h-10 w-full rounded-lg border bg-background px-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        )}
        <p className="text-xs text-muted-foreground">Not every model is available on every account — “Test connection” checks yours.</p>
      </div>

      <div className="space-y-2">
        <label htmlFor={ids.llm} className="text-sm font-semibold">{p.keyLabel}</label>
        <SecretInput id={ids.llm} value={form[p.keyField]} onChange={(v) => update({ [p.keyField]: v } as Partial<ApiSettings>)} placeholder={p.placeholder} describedBy={ids.llmHint} />
        <p id={ids.llmHint} className="text-xs text-muted-foreground">
          Get one at <a href={p.getKey} target="_blank" rel="noreferrer" className="text-tested hover:underline">{new URL(p.getKey).hostname}</a>.
          {serverHas(form.provider) ? " Leave empty to use this server's key." : ""}
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor={ids.tavily} className="text-sm font-semibold">Tavily API key <span className="font-normal text-muted-foreground">(web search)</span></label>
        <SecretInput id={ids.tavily} value={form.tavilyKey} onChange={(v) => update({ tavilyKey: v })} placeholder="tvly-…" describedBy={ids.tavilyHint} />
        <p id={ids.tavilyHint} className="text-xs text-muted-foreground">
          Free at <a href="https://app.tavily.com" target="_blank" rel="noreferrer" className="text-tested hover:underline">app.tavily.com</a>.
          {serverHas("tavily") ? " Leave empty to use this server's key." : ""}
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.remember} onChange={(e) => update({ remember: e.target.checked })} className="size-4 accent-[var(--foreground)]" />
        Remember on this device (otherwise forgotten when you close the tab)
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit">Save</Button>
        <Button type="button" variant="outline" onClick={test} disabled={testing}>
          {testing && <Loader2 className="animate-spin" aria-hidden />} Test connection
        </Button>
        {hadSaved && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              clearSettings();
              setForm({ ...EMPTY_SETTINGS, provider: server?.llm.provider ?? "groq" });
              setHadSaved(false);
              setSaved(false);
              setResults(null);
            }}
          >
            Clear saved keys
          </Button>
        )}
      </div>

      <div aria-live="polite" className="space-y-2">
        {saved && (
          <p className="text-sm text-easy">
            Saved. New guides will use {PROVIDER_LABEL[form.provider]} · <span className="font-mono text-xs">{form.model || MODEL_PRESETS[form.provider][0].id}</span>.{" "}
            <Link href="/" className="text-tested hover:underline">Generate a guide →</Link>
          </p>
        )}
        {results?.error && <p className="text-sm text-hard">{results.error}</p>}
        <CheckLine label="AI model" result={results?.llm} />
        <CheckLine label="Web search" result={results?.search} />
      </div>

      <p className="flex gap-2 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
        <ShieldCheck className="size-4 shrink-0" aria-hidden />
        Keys are stored only in this browser. They are sent to this server when you start a guide or test the
        connection, used for that job only, and never saved to the database or written to logs. Testing makes one tiny
        request to each service.
      </p>
    </form>
  );
}
