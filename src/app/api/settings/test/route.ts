// POST /api/settings/test — check the visitor's keys before they generate anything.
// One tiny JSON call to the chosen model and one 1-result search. Keys are used for this request
// only and never stored or logged.
import { NextResponse } from "next/server";
import { z } from "zod";
import { CredentialsInput, resolveCredentials, runWithCredentials } from "@/lib/credentials";
import { callJson, resolveModel } from "@/lib/llm";
import { search } from "@/lib/search";
import { explainError, type ErrorExplanation } from "@/lib/service-error";
import { configStatus } from "@/server/config-status";
import { errorResponse, HttpError, parseBody } from "@/server/http";
import { clientIp, createRateLimiter } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

const Body = z.object({ credentials: CredentialsInput.optional() });
const testLimiter = createRateLimiter(10, 10 * 60_000);

export interface ServiceCheck {
  ok: boolean;
  usingServerKey: boolean;
  error?: ErrorExplanation;
}

export async function POST(req: Request) {
  try {
    const { credentials } = await parseBody(req, Body);
    if (!testLimiter.check(clientIp(req))) throw new HttpError(429, "Too many tests — wait a few minutes");
    const creds = resolveCredentials(credentials);
    const status = configStatus(creds);
    const llmKeyFromUser = creds.provider === "groq" ? !!credentials?.groqKey : !!credentials?.anthropicKey;

    const run = async (fn: () => Promise<unknown>): Promise<Omit<ServiceCheck, "usingServerKey">> => {
      try {
        await runWithCredentials(creds, fn);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: explainError(err) };
      }
    };
    const [llm, searchCheck] = await Promise.all([
      run(() => callJson('Return exactly {"ok": true}', z.object({ ok: z.literal(true) }), { effort: "low", maxTokens: 300, label: "test" })),
      run(() => search("OAuth app registration", { maxResults: 1 })),
    ]);

    return NextResponse.json({
      llm: { ...llm, provider: creds.provider, model: resolveModel(creds), usingServerKey: !llmKeyFromUser && status.llm.keySet },
      search: { ...searchCheck, usingServerKey: !credentials?.tavilyKey && status.search.keySet },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
