// Which services this server can use — reports key presence only, never values.
import { env } from "@/lib/env";
import { KEY_ENV, provider, resolveModel } from "@/lib/llm";
import { ServiceError } from "@/lib/service-error";

export interface ConfigStatus {
  llm: { provider: "groq" | "anthropic"; model: string; keyName: string; keySet: boolean };
  search: { provider: "tavily"; keyName: "TAVILY_API_KEY"; keySet: boolean };
  /** True when new guides can be generated (both keys present). */
  canGenerate: boolean;
}

export function configStatus(): ConfigStatus {
  const p = provider();
  const keyName = KEY_ENV[p];
  const llmKeySet = !!env()[keyName];
  const searchKeySet = !!env().TAVILY_API_KEY;
  return {
    llm: { provider: p, model: resolveModel(), keyName, keySet: llmKeySet },
    search: { provider: "tavily", keyName: "TAVILY_API_KEY", keySet: searchKeySet },
    canGenerate: llmKeySet && searchKeySet,
  };
}

/** Refuse to queue a job that can only fail; the error explains which key to add. */
export function assertCanGenerate(): void {
  const s = configStatus();
  if (!s.llm.keySet) throw new ServiceError("llm", s.llm.provider, "missing_key", `${s.llm.keyName} is not set`);
  if (!s.search.keySet) throw new ServiceError("search", "tavily", "missing_key", "TAVILY_API_KEY is not set");
}
