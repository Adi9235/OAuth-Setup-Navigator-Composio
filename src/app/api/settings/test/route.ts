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
const TEST_TIMEOUT_MS = 45_000;
class TestTimeout extends Error {}

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

    // Answer well inside proxy timeouts (Render/Cloudflare cut requests at ~100s): a provider that
    // makes us wait (per-minute rate limit) is reported instead of hanging the request.
    const run = async (fn: () => Promise<unknown>): Promise<Omit<ServiceCheck, "usingServerKey">> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TestTimeout()), TEST_TIMEOUT_MS);
      });
      try {
        await Promise.race([runWithCredentials(creds, fn), timeout]);
        return { ok: true };
      } catch (err) {
        if (err instanceof TestTimeout)
          return {
            ok: false,
            error: {
              code: "rate_limited",
              title: "No answer within 45 seconds",
              detail: "The provider is slowing requests down — usually a per-minute rate limit on a free tier.",
              hint: "Wait a minute and test again. The key itself may be fine.",
            },
          };
        return { ok: false, error: explainError(err) };
      } finally {
        clearTimeout(timer);
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
