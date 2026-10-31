# OAuth Setup Navigator

> Know before you start: how hard it is to get an OAuth app approved, how long it takes, and
> what can block you — with evidence for every claim.

**Live demo:** https://oauth-setup-navigator-slp4.onrender.com/  ·  **Repo:** https://github.com/Adi9235/OAuth-Setup-Navigator-Composio

## The problem

To let an AI agent act on a user's Gmail, Slack or Notion, a developer first has to register an
**OAuth app** with that provider — client credentials, redirect URIs, scopes, consent screen — and
sometimes get it **reviewed**. That is a different layer from the developer's own integration code
and from each end user clicking "Allow". Clicking through a console is easy; the real pain is not
knowing upfront whether it takes ten minutes or six weeks: whether there is a review, a security
assessment, a partner program, a paid plan, or a domain-verification step waiting at the end.

## What I built

- **A library of guides** chosen to span setup challenges. Difficulty comes from the agent's
  evidence plus fixed rules, not from this table:

  | App | Difficulty (computed) | Rules that fired | Why it's in the set |
  |---|---|---|---|
  | GitHub | Easy | R8 | Self-serve baseline |
  | Slack | Medium | R5 | Instant for your own workspace; Marketplace adds review |
  | Notion | Medium | R5 | Internal vs. public connection |
  | Google (Workspace APIs) | Hard | R2, R5 | Sensitive/restricted scopes, possible security assessment |
  | LinkedIn | _not yet generated_ | — | Product/partner-gated access (see Limitations) |
  | Airtable | Easy | R8 | Generated live while testing an unseen app |

  All current guides are **low confidence** (rule R9): providers rarely state "no review needed"
  outright, so the agent honestly marks those requirements *Unclear* instead of guessing.
- **Live generation:** type any app name or URL → the agent researches, probes, verifies and writes
  a guide while the page streams progress → saved to the library at a shareable `/guides/[slug]`.
- **Evidence on every claim:** *Tested* (a probe ran), *Sourced* (a fetched page states it — tap
  the badge to see the excerpt), or *Uncertain* (with the reason).
- **Re-check** a guide to detect doc changes; a new version is created only if something changed.
  Version history, Markdown export, copy link, and "This didn't work" feedback on steps.

## Reviewer quickstart

**On the live demo — no setup:**

1. Browse the library; guides need no keys.
2. Click **API keys** (key icon in the header). Pick **Groq** (free) or **Anthropic (Claude)**, pick a
   model (or "Other model…"), paste your key plus a free [Tavily](https://app.tavily.com) key, and
   press **Test connection** — each service shows ✓ or a plain-language reason it failed.
3. **Save**, go home and type any app (e.g. `zoom.us`). The status line under the search box shows
   which provider, model and keys the job will use.

Keys stay in your browser (localStorage, or only for the tab if you untick "Remember"). They are sent
with the request that starts a job, held in server memory just for that job, and never stored in the
database or logged. If you enter nothing, the server's own `.env` keys are used when it has them.

**Running it yourself (Windows, macOS or Linux):**

Prerequisites: **Node.js 22+** ([nodejs.org](https://nodejs.org), or `nvm use` — the repo has
`.nvmrc`), **Git**, and a **Postgres** database: either [Docker](https://www.docker.com/products/docker-desktop/)
(local) or a free [Neon](https://neon.tech) project (nothing to install).

The commands are identical on every OS (PowerShell, cmd, Terminal, bash, zsh):

```bash
git clone https://github.com/Adi9235/OAuth-Setup-Navigator-Composio.git
cd OAuth-Setup-Navigator-Composio
npm install
npm run setup            # checks Node, creates .env from .env.example, prints next steps
```

Then choose a database:

- **Docker (local):** `docker compose up -d` — the default `DATABASE_URL` in `.env` already points to it.
- **Neon (cloud):** paste your Neon connection string (`postgresql://…?sslmode=require`) into
  `DATABASE_URL` in `.env`.

```bash
npm run db:migrate       # create the tables
npm run build
npm start                # open http://localhost:3000, then add keys on the API keys page
```

Optional: `npm run db:seed` generates the five seed guides (needs API keys in `.env`; uses credits).
Use `npm run build && npm start` rather than `npm run dev` for the agent: the dev server recompiles
while long jobs run and can run out of memory on smaller machines.

| Variable | Needed for | Notes |
|---|---|---|
| `DATABASE_URL` | everything | Neon/Supabase URL (`?sslmode=require`) or local Docker |
| `LLM_PROVIDER` | server default | `groq` (default) or `anthropic`; visitors can choose their own |
| `GROQ_API_KEY` | optional server key | free at console.groq.com; used when a visitor enters none |
| `ANTHROPIC_API_KEY` | optional server key | Claude Console → API Keys (needs credit) |
| `LLM_MODEL` | optional | defaults: `openai/gpt-oss-120b` (Groq), `claude-sonnet-5-5` (Anthropic) |
| `TAVILY_API_KEY` | optional server key | free at tavily.com (web search) |
| `JOB_CONCURRENCY`, `APP_BASE_URL`, `USER_AGENT` | runtime | see `.env.example` |

**Switching providers** is a choice on the API keys page (or `LLM_PROVIDER` for the server
default); nothing else changes. Claude gets larger budgets (10 pages per app, more facts, parallel calls); Groq's free tier
is throttled to fit its limits. The **About** page and `GET /api/health` show which provider/model
is active and which keys are set (never their values). Browsing the library needs only the database.

### When something isn't configured or a quota runs out

The app says what happened and what to do — it never just spins or shows "something went wrong":

| Situation | What the user sees |
|---|---|
| No key anywhere | Home: "To generate new guides, add your Groq key… Open API keys →"; the API refuses to queue the job |
| Key rejected | "Groq rejected the API key — check the key on the API keys page" + **Fix in Settings** |
| Groq free daily limit used up | "Groq usage limit reached — the app itself is working. Try again in ~5 minutes, or enter your own Groq key on the API keys page. Or switch to Claude" (fails immediately, with the reset time Groq reports) |
| Anthropic account has no credit | "Anthropic (Claude) account has no credit — add credits, or switch to Groq's free tier on the API keys page" |
| Model not on this account | "The configured model isn't available — pick another model on the API keys page" |
| Per-minute rate limit | waits and retries automatically (up to 3 minutes per call), then explains |
| Tavily credits used up / key rejected | same pattern, naming `TAVILY_API_KEY` |
| One page can't be read or parsed | the job continues without that page and says so in the log |

## Key decisions

1. **Scope and format.** Five seed apps that each stress a different setup challenge. Every guide
   answers "how bad is this?" in five seconds (difficulty, hands-on time, approval wait, cost) before
   anything else; steps, scopes and evidence are one scroll away.
2. **Difficulty by rules, not the LLM.** `difficulty.ts` applies R1–R9 to seven evidence-backed
   signals, so the same evidence always gives the same rating and the "Why this rating" list is
   exact. A signal the agent could not back with evidence becomes *Unclear* and cannot raise the
   rating.
3. **Four-step agent instead of one prompt** — research → probe → verify → compose. Separate steps
   let code enforce honesty between them: a fact is dropped if its "verbatim" excerpt isn't on the
   page; a second strict pass verifies each fact; the composer cites facts by id (`F3`, `P2`) and
   **code** turns citations into evidence and links, so a *Sourced* claim can only point at a page
   that was fetched, and URLs the agent never saw are removed.
4. **Probes as real testing, without accounts.** Read-only GETs: OAuth/OIDC discovery documents, the
   authorize endpoint with a deliberately invalid `client_id` (proves it is live), and the developer
   console (does it redirect to sign-in?). They prove endpoints exist; they cannot prove review rules
   or timelines, so those stay *Sourced* or *Uncertain*.
5. **Agent vs. human split.** Each step is owned by *Agent* (drafting scope justifications,
   preparing redirect URIs, a privacy-policy draft, checking docs), *You* (login, legal acceptance,
   payment, identity, demo video, waiting) or *Agent + You*.
6. **Single Node service + Postgres queue.** The `jobs` table is the queue; an in-process runner
   polls it, a partial unique index makes concurrent submissions of the same app share one job, and
   progress events live in `job_events` so a refresh replays them. Callers only insert rows, so the
   runner can move to BullMQ/Redis without changing them.
7. **Claims linked to sources.** Every claim row links to the source snapshot it came from, so a
   re-check knows exactly which claims a changed page affects and re-verifies only those.
8. **Provider-agnostic LLM layer.** `src/lib/llm.ts` exposes one `callJson(prompt, zodSchema)` with
   validation + one retry; adapters for Groq and Anthropic map every failure to a typed error.

## What I verified

- **Automated:** 122 unit tests — schema and evidence rules, normalization, every difficulty rule,
  citation integrity (unseen URLs dropped, uncited signals downgraded, placeholder approval waits),
  excerpt checking, provider error mapping (Groq daily vs. per-minute limits, Anthropic credit,
  Tavily quotas), fail-fast behaviour, per-job key isolation (two concurrent jobs with different
  keys never see each other's), Markdown export, and job-runner failure reporting.
- **End-to-end runs:** GitHub, Slack, Notion, Google and Airtable were generated through the real
  pipeline (Groq + Tavily); the browser flow (search → live progress → shareable guide) was checked
  at 375 px and 1280 px with no console errors.
- **Human spot-check:** see [`VERIFICATION.md`](VERIFICATION.md). The sample checklist is in
  `verification/checklist.json`; results are recorded by a person, never by the agent.

## Deploy (Render + Neon)

1. Create a free Postgres on [Neon](https://neon.tech) and copy its connection string.
2. Push this repo to GitHub. In Render: **New → Blueprint**, pick the repo; `render.yaml` defines a
   Node web service (`npm ci --include=dev && npm run build`, start `npm run db:migrate && npm start`,
   health check `/api/health`).
3. Set `DATABASE_URL` and `APP_BASE_URL` (your Render URL) in the dashboard. Server API keys
   (`GROQ_API_KEY`, `TAVILY_API_KEY`, …) are optional: without them, visitors bring their own on
   the API keys page.
4. Seed the library once from your machine against the same database: `npm run db:seed`.

Use a long-running service, not serverless: agent jobs take minutes. Render's free plan sleeps after
15 idle minutes; a job interrupted that way is marked failed on the next boot (crash recovery).

## Scripts

| Command | What it does |
|---|---|
| `npm run setup` | check Node, create `.env`, print next steps (any OS) |
| `npm run db:migrate` | apply `db/schema.sql` (idempotent; `-- --reset` to recreate) |
| `npm run db:seed` | generate missing seed guides (`-- --refresh` to re-research, or name apps) |
| `npm run generate -- "zoom.us"` | run the agent from the CLI and print a summary |
| `npx tsx scripts/recheck.ts github` | re-check one guide |
| `npm run spot-check` / `-- --apply` | build the human checklist / record results + write VERIFICATION.md |
| `npm run check:llm` | test the configured LLM key and model |
| `npx tsx scripts/cancel-job.ts <id>` | mark a stuck job failed |
| `npm run typecheck && npm run lint && npm test` | quality gate |

## Troubleshooting

| Problem | Fix |
|---|---|
| `npm run setup` says Node is too old | Install Node 22+ (or `nvm install 22 && nvm use`) |
| `db:migrate` can't connect | Docker: is `docker compose up -d` running? Neon: does the URL end with `?sslmode=require`? |
| Port 3000 already in use | Stop the other server, or run `npx next start -p 3001` |
| Tests fail with "Cannot find native binding" (rolldown) | npm optional-dependency bug: delete `node_modules` and run `npm install` again |
| A job page stays on "running" after a crash | `npx tsx scripts/cancel-job.ts <job-id>` (it is also auto-failed on next start) |
| "Groq usage limit reached" | Free tier is ~3–4 guides/day: wait, use your own key, or switch to Claude on the API keys page |

## Limitations

- **Groq free tier is tight:** about 8,000 tokens per minute and 200,000 per day for
  `gpt-oss-120b`, enough for roughly three or four guides a day. That is why the LinkedIn guide and
  two of the three "unseen app" tests (Zoom, Calendly) are not generated yet; the code path is the
  same as the guides that were. With your own key or `LLM_PROVIDER=anthropic` they run normally.
- **Thinner research on Groq:** 6 pages per app and short page excerpts (vs. 10 pages on Claude).
- **Approval times are rarely published**, so most review waits are a marked placeholder range.
- **Probes can't see inside authenticated consoles**; JS-only docs pages may be unreadable (the job
  log says so).
- **Ambiguous names** ("Teams") rely on the agent's assumption, which is shown as a warning.
- No user accounts; job creation is rate-limited per IP.
- `next dev` occasionally ran out of memory on the development machine; production builds
  (`npm run build && npm start`) were unaffected.

## Hosting notes (Render / Cloudflare)

- Jobs run in the background; HTTP requests return immediately, so proxy timeouts (~100 s) don't
  affect multi-minute jobs. Live progress is Server-Sent Events with a 15 s heartbeat and
  no-buffering headers; if a proxy drops the stream, the browser reconnects and replays from the DB.
- Keys from the API keys page travel over HTTPS and are handed to the job in process memory, so
  run **one instance** (the free plan always does). Scaling out would need a shared secret store.
- "Test connection" answers within 45 s even if a provider is rate-limiting.
- Some docs sites block data-center IPs; the agent skips unreadable pages and says so in the log.

## How this scales to 100+ apps

Scheduled re-checks from `guides.next_check_at` (shorter intervals for hard apps), changelog/RSS
watchers per provider, feedback thresholds that trigger a re-check, a Redis-backed queue with
separate workers, sources shared across guides (one fetch serves many), and a human review queue
for claims marked `needs_review`.
