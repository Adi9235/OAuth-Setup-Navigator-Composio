# CLAUDE.md — OAuth Setup Navigator

Project memory for Claude Code. Read this at the start of every session.

## What this is
A web app where a developer types an app name or website and gets a guide for creating that
provider's OAuth app and getting it approved: difficulty, hands-on time, approval wait,
requirements, steps (agent vs. human), blockers, and evidence for every claim.
Full spec: `docs/SPEC.md`.

## Stack (do not change without asking)
- **App:** Next.js 15 (App Router) + TypeScript (strict) + Tailwind CSS + shadcn/ui
- **DB:** Postgres via `pg` + plain SQL (schema in `db/schema.sql`). No ORM. Typed query helpers in `src/lib/db/`.
- **Validation:** Zod for the guide contract and every API input/output
- **LLM:** Anthropic SDK (`@anthropic-ai/sdk`), behind a thin `src/lib/llm.ts` wrapper so the
  provider can be swapped. Model name from `LLM_MODEL` env var.
  `LLM_PROVIDER=groq|anthropic` (approved by the developer): **Groq is the default** (free tier,
  so the project runs without paid keys); Claude is a one-line switch (`LLM_PROVIDER=anthropic`).
  Adapters in `src/lib/llm-providers.ts`; per-provider budgets via `llmProfile()` in `src/lib/llm.ts`.
- **Web search:** Tavily API (`TAVILY_API_KEY`), behind `src/lib/search.ts`
- **Page reading:** `fetch` + `@mozilla/readability` + `jsdom` → clean text
- **Jobs:** in-process job runner (`src/server/jobs/runner.ts`) backed by the `jobs` table.
  Designed so it can later move to BullMQ/Redis without changing callers.
- **Live progress:** Server-Sent Events from `job_events`
- **Tests:** Vitest. Unit tests for difficulty rules, normalization, schema validation, hashing.
- **Deploy target:** a single long-running Node service (Railway or Render) + managed Postgres
  (Neon or Supabase). Not Vercel serverless — agent jobs run 1–3 minutes.

## Commands
- `npm run dev` — local dev
- `npm run db:migrate` — apply `db/schema.sql` to `DATABASE_URL`
- `npm run db:seed` — generate seed guides via the agent and store them
- `npm run check:llm` — verify the configured LLM key/model; `GET /api/health` shows config
- `npm run typecheck && npm run lint && npm test` — must pass before every commit

## Hard rules
1. **Never invent provider facts.** Every claim needs evidence: `tested` (a probe ran),
   `sourced` (a fetched page supports it, URL stored), or `uncertain` (say why).
2. **Difficulty is computed by code** (`src/server/agent/difficulty.ts`), never chosen by the LLM.
3. **LLM output is always validated with Zod.** On failure, retry once with the validation error
   appended; then fail the step with a clear job event.
4. **No secrets in code, logs, or commits.** Only env vars from `.env.example`.
5. **Probes are read-only and unauthenticated.** Never create accounts, submit forms, accept
   terms, or log in to provider consoles. Only GET public URLs.
6. **Respect sites:** set a descriptive User-Agent, timeout 15s, max 3 concurrent fetches per job,
   cache fetched pages for the duration of a job.
7. Keep components small; server code in `src/server/`, shared types in `src/lib/`.
8. Commit at the end of every milestone in `docs/BUILD_PLAN.md`.

## Conventions
- Evidence enum: `'tested' | 'sourced' | 'uncertain'`
- Step owner enum: `'agent' | 'you' | 'both'`
- Difficulty enum: `'easy' | 'medium' | 'hard'`
- App identity = normalized registrable domain (e.g. `notion.so`). Slug = lowercased name, kebab-case.
- Time values stored as min/max ranges, never single numbers.
- Dates in UI: relative ("verified 3 days ago") with ISO in a tooltip.
