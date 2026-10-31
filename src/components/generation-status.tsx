"use client";

import { KeyRound } from "lucide-react";
import Link from "next/link";
import { effectiveSetup, PROVIDER_LABEL, useApiSettings, useServerConfig } from "./api-settings";

/** One line under the search box: which provider/model/keys a new guide will use. */
export function GenerationStatus() {
  const { settings, loaded } = useApiSettings();
  const server = useServerConfig();
  if (!loaded || !server) return null;
  const s = effectiveSetup(settings, server);

  if (!s.canGenerate) {
    const missing = [s.llmKey === "missing" && `${PROVIDER_LABEL[s.provider]} key`, s.searchKey === "missing" && "Tavily key"].filter(Boolean).join(" and ");
    return (
      <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-uncertain/50 bg-uncertain/5 px-3 py-2 text-sm">
        <KeyRound className="size-4 text-uncertain" aria-hidden />
        To generate new guides, add your {missing}.
        <Link href="/settings" className="font-medium text-tested hover:underline">Open API keys →</Link>
        <span className="text-muted-foreground">Existing guides work without keys.</span>
      </p>
    );
  }

  const whose = s.llmKey === "yours" && s.searchKey === "yours" ? "your keys" : s.llmKey === "server" && s.searchKey === "server" ? "this server's keys" : "your keys + this server's";
  return (
    <p className="mt-3 text-xs text-muted-foreground">
      New guides use {PROVIDER_LABEL[s.provider]} · <span className="font-mono">{s.model}</span> · {whose}.{" "}
      <Link href="/settings" className="text-tested hover:underline">Change</Link>
    </p>
  );
}
