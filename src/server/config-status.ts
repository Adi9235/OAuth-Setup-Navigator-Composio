// Which services a job can use — reports key presence only, never values.
import { serverCredentials, type Credentials } from "@/lib/credentials";
import { KEY_ENV, resolveModel } from "@/lib/llm";
import { ServiceError } from "@/lib/service-error";

export interface ConfigStatus {
  llm: { provider: "groq" | "anthropic"; model: string; keyName: string; keySet: boolean };
  search: { provider: "tavily"; keyName: "TAVILY_API_KEY"; keySet: boolean };
  /** True when new guides can be generated (both keys present). */
  canGenerate: boolean;
}

/** Status for the given credentials (default: the server's own .env). */
export function configStatus(creds: Credentials = serverCredentials()): ConfigStatus {
  const p = creds.provider;
  const llmKeySet = !!(p === "groq" ? creds.groqKey : creds.anthropicKey);
  const searchKeySet = !!creds.tavilyKey;
  return {
    llm: { provider: p, model: resolveModel(creds), keyName: KEY_ENV[p], keySet: llmKeySet },
    search: { provider: "tavily", keyName: "TAVILY_API_KEY", keySet: searchKeySet },
    canGenerate: llmKeySet && searchKeySet,
  };
}

/** Refuse to queue a job that can only fail; the error explains which key to add. */
export function assertCanGenerate(creds: Credentials = serverCredentials()): void {
  const s = configStatus(creds);
  if (!s.llm.keySet) throw new ServiceError("llm", s.llm.provider, "missing_key", `${s.llm.keyName} is not set`);
  if (!s.search.keySet) throw new ServiceError("search", "tavily", "missing_key", "TAVILY_API_KEY is not set");
}
