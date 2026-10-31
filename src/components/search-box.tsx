"use client";

import { Loader2, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ResolveResponse } from "@/lib/api-types";
import { credentialsPayload } from "./api-settings";
import { GenerationStatus } from "./generation-status";

const EXAMPLES = ["Slack", "Google", "Airtable", "zoom.us"];

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Something went wrong");
  return data;
}

export function SearchBox() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // "/" focuses search (UI_SPEC keyboard shortcut).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || t?.closest("input, textarea, [contenteditable]")) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = async (input: string) => {
    const q = input.trim();
    if (!q) {
      setError("Enter an app name or URL");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await postJson<ResolveResponse>("/api/resolve", { input: q });
      if (r.type === "guide") return router.push(`/guides/${r.slug}`);
      if (r.type === "job") return router.push(`/jobs/${r.jobId}`);
      const { jobId } = await postJson<{ jobId: string }>("/api/jobs", { input: q, credentials: credentialsPayload() });
      router.push(`/jobs/${jobId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  };

  return (
    <div>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(value);
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <label htmlFor="app-search" className="sr-only">App name or website</label>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            ref={inputRef}
            id="app-search"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError("");
            }}
            maxLength={200}
            placeholder="Enter an app name or website…"
            autoComplete="off"
            aria-invalid={!!error}
            aria-describedby={error ? "search-error" : "search-hint"}
            className="h-11 w-full rounded-lg border bg-background pl-9 pr-10 text-base shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-hard"
          />
          <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border px-1.5 font-mono text-[11px] text-muted-foreground sm:block">/</kbd>
        </div>
        <Button type="submit" disabled={busy} className="h-11 px-5">
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          Get guide
        </Button>
      </form>
      {error ? (
        <p id="search-error" role="alert" className="mt-2 text-sm text-hard">{error}</p>
      ) : (
        <p id="search-hint" className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          Try:
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              disabled={busy}
              onClick={() => {
                setValue(ex);
                void submit(ex);
              }}
              className="rounded-full border px-2.5 py-0.5 text-foreground hover:bg-muted"
            >
              {ex}
            </button>
          ))}
        </p>
      )}
      <GenerationStatus />
    </div>
  );
}
