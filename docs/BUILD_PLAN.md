# BUILD PLAN — follow in order, commit after each milestone

Total budget ≈ 7 hours of build time. Time boxes are guides; if a milestone overruns by >50%,
stop and report the tradeoff.

## M0 — Scaffold (30 min)
- `create-next-app` (TS, App Router, Tailwind, ESLint), add shadcn/ui, Zod, pg, @anthropic-ai/sdk,
  tldts, @mozilla/readability, jsdom, diff, vitest.
- `.env.example` copied in; `src/lib/env.ts` validates env with Zod at boot.
- `scripts/migrate.ts` applies `db/schema.sql`. `npm run db:migrate` works against local Postgres
  (provide `docker-compose.yml` with postgres:16).
- **Done when:** app boots, migration runs, `npm test` runs one passing test.

## M1 — Core libs (45 min)
- `guide-schema.ts` (from GUIDE_SCHEMA.md) + tests (valid sample passes, evidence rules enforced).
- `normalize.ts` + tests (cases in ARCHITECTURE.md §4).
- `difficulty.ts` + confidence + tests covering every rule R1–R9.
- `hash.ts`, `fetch-page.ts` (readability, timeout, UA, size cap 2MB), `search.ts` (Tavily), `llm.ts`
  (JSON-mode helper: `callJson(prompt, zodSchema)` with one retry on validation failure).
- DB helpers for every table used.
- **Done when:** all unit tests pass.

## M2 — Job runner + SSE (45 min)
- `runner.ts` polling loop, concurrency, crash recovery; `events.ts` `emit(jobId, step, level, msg, payload)`.
- API: `POST /api/resolve`, `POST /api/jobs` (dedupe via unique index), `GET /api/jobs/[id]`,
  `GET /api/jobs/[id]/events` (replay + tail + heartbeat).
- Fake pipeline that emits timed events, to test the live page early.
- Minimal `/jobs/[id]` page showing events.
- **Done when:** submitting twice shares a job; refresh replays events.

## M3 — Agent pipeline (2 h)
- identify → research (search, fetch, extract) → probe → verify → compose, per AGENT_PIPELINE.md.
- Prompts in `src/server/agent/prompts/`.
- Persist sources, snapshots, probes, claims, claim_sources, verification_log, version.
- Post-compose integrity check (URLs/probeIds exist).
- CLI: `npx tsx scripts/generate.ts "github"` runs the pipeline without the UI and prints a summary.
- **Done when:** generating GitHub and Slack produce valid guides with sensible difficulty and
  every claim has evidence. Show me both summaries.

## M4 — UI (1.5 h)
- Home, Guide, Live job page, About — per UI_SPEC.md. Use the frontend-design skill if available
  for a distinctive but calm look.
- Markdown export endpoint + Copy link.
- Live page renders guide sections progressively.
- **Done when:** full flow works in the browser at desktop and 375px width with no console errors.

## M5 — Seed + re-check + feedback (45 min)
- `scripts/seed.ts` generates the 5 seed apps (GitHub, Slack, Notion, Google, LinkedIn).
- Re-check job per EVIDENCE_AND_VERIFICATION.md; freshness badge updates.
- Feedback endpoint + "This didn't work" link.
- **Done when:** library shows 5 guides; re-check on one guide runs and creates a version only if
  something changed.

## M6 — Verification + README + deploy (45 min)
- `scripts/spot-check.ts` → checklist; `VERIFICATION.md` template (human fills results).
- README (use `docs/README_TEMPLATE.md`).
- Deploy instructions for Railway/Render + Neon; `npm run build && npm start` works.
- Live test with 3 unseen apps (e.g. Airtable, Zoom, Calendly); fix any failure modes found
  (no OAuth, ambiguous name, docs behind JS rendering) and note them in README limitations.
- **Done when:** a fresh clone + `.env` + migrate + seed + start works; README complete.

## Quality bar for every milestone
- `npm run typecheck && npm run lint && npm test` pass
- No `any` without a comment; no secrets; no console errors in the browser
- Commit message: `M<n>: <what works now>`
