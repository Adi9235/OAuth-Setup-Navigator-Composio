// Sanity-check the configured LLM provider: key works, model exists, JSON round-trip succeeds.
//   npm run check:llm
import { loadEnvFile } from "./load-env";
loadEnvFile();

import { z } from "zod";
import { env } from "@/lib/env";
import { callJson, provider, resolveModel } from "@/lib/llm";

async function main() {
  const p = provider();
  const model = resolveModel();
  console.log(`Provider: ${p} · model: ${model}`);

  if (p === "groq") {
    const key = env().GROQ_API_KEY;
    if (!key) throw new Error("GROQ_API_KEY is not set");
    const res = await fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`Groq /models returned HTTP ${res.status} — check GROQ_API_KEY`);
    const ids = ((await res.json()) as { data: { id: string }[] }).data.map((m) => m.id).sort();
    console.log(`Model available on this key: ${ids.includes(model) ? "yes" : "NO"}`);
    if (!ids.includes(model)) console.log(`Available models: ${ids.join(", ")}`);
  }

  const out = await callJson('Return {"ok": true, "provider": "<your provider name>"}', z.object({ ok: z.literal(true) }).passthrough(), {
    effort: "low",
    maxTokens: 200,
    label: "check",
  });
  console.log("JSON round-trip:", JSON.stringify(out));
}

main().catch((err: unknown) => {
  console.error("✗", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
