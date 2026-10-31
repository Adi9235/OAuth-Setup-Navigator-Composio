# ARCHITECTURE

## 1. Overview
```
Browser (Next.js pages)
   │  search / view guide / watch job (SSE)
   ▼
Next.js route handlers (API)  ──────────────►  Postgres
   │  enqueue job                                ▲
   ▼                                             │ writes events, sources,
In-process job runner ──► Agent pipeline ────────┘ probes, claims, versions
                          research → probe → verify → compose
                              │        │
                         Tavily search  public HTTP GETs (docs, discovery endpoints)
                              │
                           LLM (Anthropic)
```
One Node process serves the UI, the API, and runs jobs. The `jobs` table is the queue; the
runner polls it (every 1s) and processes up to `JOB_CONCURRENCY` (default 2) jobs at once.
On boot, any job stuck in `running` for >10 min is marked `failed` (crash recovery).

## 2. Request flows

### Lookup (library hit)
1. `POST /api/resolve { input }` → normalize input → find app by domain, slug, or alias.
2. If a published guide exists → `{ type: "guide", slug }` → client navigates to `/guides/[slug]`.

### Live generation (library miss)
1. `POST /api/resolve` finds no app → `POST /api/jobs { input }`.
2. Server normalizes the domain; inserts a job. If the partial unique index
   `uq_jobs_active_per_domain` conflicts, return the existing active job id instead.
3. Client navigates to `/jobs/[id]`, opens `GET /api/jobs/[id]/events` (SSE).
4. SSE handler: send all existing `job_events` for the job (replay), then poll for new rows every
   500ms (track last `id`), send heartbeat every 15s, close when job is terminal.
5. On success, final event payload contains `{ slug }`; client shows the full guide and a
   "Open shareable page" button.

### Re-check
`POST /api/guides/[slug]/recheck` → job_type `recheck` → re-fetch every source of the current
version, compare hashes, re-verify only claims linked to changed sources, re-run probes; if
anything changed → new `guide_versions` row with `change_summary`; update `guides.freshness`.

## 3. API contract (all bodies validated with Zod)
| Method | Path | Body / Params | Response |
|---|---|---|---|
| GET | `/api/guides` | `?difficulty=easy\|medium\|hard&q=` | `GuideCard[]` |
| GET | `/api/guides/[slug]` | — | `{ app, guide: Guide, version_no, freshness, last_verified_at, versions: {no, created_at, change_summary}[] }` |
| GET | `/api/guides/[slug].md` | — | Markdown export (`text/markdown`) |
| POST | `/api/resolve` | `{ input: string }` | `{ type: "guide", slug } \| { type: "job", jobId } \| { type: "new" }` |
| POST | `/api/jobs` | `{ input: string }` | `{ jobId }` (existing job if one is active for that domain) |
| GET | `/api/jobs/[id]` | — | job row + current step |
| GET | `/api/jobs/[id]/events` | — | SSE stream of `JobEvent` |
| POST | `/api/guides/[slug]/recheck` | — | `{ jobId }` |
| POST | `/api/feedback` | `{ slug, claimId?, kind, comment? }` | `{ ok: true }` |

Rate limit `POST /api/jobs` to 5 per IP per 10 minutes (simple in-memory limiter is fine).
Input max length 200 chars; reject anything that isn't a plausible app name or URL.

## 4. Input normalization (`src/lib/normalize.ts`)
- Trim, lowercase. If it parses as a URL (add `https://` if missing a scheme and it contains a
  dot), take the hostname, strip `www.`, `developer(s).`, `api.`, `docs.`, `app.` prefixes, and
  reduce to the registrable domain (use `tldts`).
- If it's a bare name ("google drive"), look up aliases/slug first; if no match, the research
  step's first job is to identify the provider's primary domain, then re-check for duplicates
  before creating the app row (two names → one app).
- Unit-test: `github`, `GitHub.com`, `https://docs.github.com/en/apps`, `www.notion.so`,
  `developers.google.com/gmail` (→ `google.com`, app name from research), `   Slack  `.

Note: Google products share `google.com`. Treat Google as one app ("Google (Workspace APIs)")
whose guide covers scope tiers; mention product-specific scopes inside it.

## 5. Folder structure
```
src/
  app/
    page.tsx                      # Home: search + library grid
    guides/[slug]/page.tsx        # Guide page (server component)
    jobs/[id]/page.tsx            # Live generation page (client, SSE)
    about/page.tsx                # Method & evidence explainer + verification report
    api/...                       # route handlers per section 3
  components/
    search-box.tsx  guide-card.tsx  difficulty-badge.tsx  evidence-badge.tsx
    summary-card.tsx  owner-split.tsx  step-checklist.tsx  requirements-list.tsx
    blockers-list.tsx  sources-list.tsx  freshness-badge.tsx  job-progress.tsx  share-bar.tsx
  lib/
    guide-schema.ts   # Zod — single source of truth (docs/GUIDE_SCHEMA.md)
    normalize.ts  llm.ts  search.ts  fetch-page.ts  hash.ts  markdown-export.ts
    db/ (pool.ts, apps.ts, guides.ts, jobs.ts, sources.ts, claims.ts, probes.ts)
  server/
    jobs/runner.ts  jobs/events.ts
    agent/
      pipeline.ts      # orchestrates steps, emits events
      research.ts  probe.ts  verify.ts  compose.ts  difficulty.ts
      prompts/ (research.md, extract.md, verify.md, compose.md)
scripts/
  migrate.ts  seed.ts  spot-check.ts
db/schema.sql
VERIFICATION.md   README.md   .env.example
```

## 6. Schema notes
Use `db/schema.sql` as-is. The guide page renders from `guide_versions.content` (JSONB, validated
by Zod). `claims` + `claim_sources` mirror each claim for change tracking and evidence links.
Each claim in `content` carries its DB `claim_id` so the UI can link feedback to it.
Minimum tables actually exercised in the take-home: apps, guides, guide_versions, sources,
source_snapshots, probe_runs, claims, claim_sources, jobs, job_events, verification_log.
`change_events` is written by re-check; `feedback` by the feedback button.

## 7. Env vars (see `.env.example`)
`DATABASE_URL`, `ANTHROPIC_API_KEY`, `LLM_MODEL`, `TAVILY_API_KEY`, `JOB_CONCURRENCY`,
`APP_BASE_URL`, `USER_AGENT`.
