"use client";

// Visitor's own API keys + provider/model choice, kept only in this browser.
// "Remember on this device" -> localStorage; otherwise sessionStorage (cleared when the tab closes).
import { useEffect, useState } from "react";

export type ProviderId = "groq" | "anthropic";

export interface ApiSettings {
  provider: ProviderId;
  model: string; // "" = provider default
  groqKey: string;
  anthropicKey: string;
  tavilyKey: string;
  remember: boolean;
}

export const MODEL_PRESETS: Record<ProviderId, { id: string; label: string }[]> = {
  groq: [
    { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B — best quality (default)" },
    { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B — faster, lighter" },
    { id: "qwen/qwen3.8-27b", label: "Qwen 3.8 27B" },
  ],
  anthropic: [
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 — balanced (default)" },
    { id: "claude-opus-5-5", label: "Claude Opus 5.5 — most capable" },
    { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 — fastest, cheapest" },
  ],
};

export const PROVIDER_LABEL: Record<ProviderId, string> = { groq: "Groq", anthropic: "Anthropic (Claude)" };

export const EMPTY_SETTINGS: ApiSettings = { provider: "groq", model: "", groqKey: "", anthropicKey: "", tavilyKey: "", remember: true };

const STORAGE_KEY = "oauth-nav:api-settings";
const CHANGED = "api-settings-changed";

function storages(): Storage[] {
  try {
    return [window.localStorage, window.sessionStorage];
  } catch {
    return [];
  }
}

export function loadSettings(): ApiSettings | null {
  for (const s of storages()) {
    try {
      const raw = s.getItem(STORAGE_KEY);
      if (raw) return { ...EMPTY_SETTINGS, ...(JSON.parse(raw) as Partial<ApiSettings>) };
    } catch {
      // unreadable entry or storage blocked — treat as not set
    }
  }
  return null;
}

export function saveSettings(settings: ApiSettings): void {
  const [local, session] = storages();
  try {
    local?.removeItem(STORAGE_KEY);
    session?.removeItem(STORAGE_KEY);
    (settings.remember ? local : session)?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // storage unavailable (private mode): settings last until the page is reloaded
  }
  window.dispatchEvent(new Event(CHANGED));
}

export function clearSettings(): void {
  for (const s of storages()) {
    try {
      s.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
  window.dispatchEvent(new Event(CHANGED));
}

/** Body field for job/test requests: only what the visitor actually filled in. */
export function credentialsPayload(settings: ApiSettings | null = loadSettings()) {
  if (!settings) return undefined;
  const trim = (v: string) => v.trim() || undefined;
  return {
    provider: settings.provider,
    model: trim(settings.model),
    groqKey: trim(settings.groqKey),
    anthropicKey: trim(settings.anthropicKey),
    tavilyKey: trim(settings.tavilyKey),
  };
}

/** Current saved settings; updates when they change in this tab or another. */
export function useApiSettings(): { settings: ApiSettings | null; loaded: boolean } {
  const [state, setState] = useState<{ settings: ApiSettings | null; loaded: boolean }>({ settings: null, loaded: false });
  useEffect(() => {
    const refresh = () => setState({ settings: loadSettings(), loaded: true });
    refresh();
    window.addEventListener(CHANGED, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(CHANGED, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return state;
}

/** The server's own configuration from GET /api/health (key presence only). */
export interface ServerConfig {
  llm: { provider: ProviderId; model: string; keyName: string; keySet: boolean };
  search: { keySet: boolean };
  canGenerate: boolean;
  keys: { groq: boolean; anthropic: boolean; tavily: boolean };
}

export function useServerConfig(): ServerConfig | null {
  const [config, setConfig] = useState<ServerConfig | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/health")
      .then((r) => r.json())
      .then((data: ServerConfig) => alive && setConfig(data))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return config;
}

/** Which provider/model/keys a new job will use, combining saved settings with server defaults. */
export function effectiveSetup(settings: ApiSettings | null, server: ServerConfig | null) {
  const provider: ProviderId = settings?.provider ?? server?.llm.provider ?? "groq";
  const userLlmKey = provider === "groq" ? !!settings?.groqKey.trim() : !!settings?.anthropicKey.trim();
  const model =
    settings?.model.trim() ||
    (server && server.llm.provider === provider ? server.llm.model : MODEL_PRESETS[provider][0].id);
  type KeySource = "yours" | "server" | "missing";
  const llmKey: KeySource = userLlmKey ? "yours" : server?.keys?.[provider] ? "server" : "missing";
  const searchKey: KeySource = settings?.tavilyKey.trim() ? "yours" : server?.keys?.tavily ? "server" : "missing";
  return { provider, model, llmKey, searchKey, canGenerate: llmKey !== "missing" && searchKey !== "missing" };
}
