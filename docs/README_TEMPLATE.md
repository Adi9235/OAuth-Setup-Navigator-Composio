# OAuth Setup Navigator

> Know before you start: how hard it is to get an OAuth app approved, how long it takes, and
> what can block you — with evidence for every claim.

**Live demo:** <url>  ·  **Repo:** <url>

## The problem
<!-- 3–4 sentences in your own words: provider OAuth app vs integration vs user connections; the
real pain is uncertainty about time, effort, and blockers, not clicking buttons. -->

## What I built
- Library of N guides chosen to span setup challenges (table: app, difficulty, why included)
- Live generation: type any app → agent researches, probes, verifies, composes → shareable guide
- Evidence on every claim: Tested / Sourced / Uncertain
- Re-check to detect doc changes; version history

## Key decisions
1. **Scope:** why these apps and this guide format (answer "how bad" in 5 seconds first).
2. **Difficulty by rules, not LLM** — reproducible and explainable.
3. **Four-step agent** (research → probe → verify → compose) instead of one prompt — why.
4. **Probes as real testing** without accounts — what they can and can't prove.
5. **Agent vs. human split** — where agents genuinely help (drafting justifications, privacy
   policy drafts, redirect URI prep, doc checking) and where humans must act.
6. **Single Node service + Postgres queue** — simple now; path to Redis/BullMQ.
7. **Claims linked to sources** — enables re-checking when docs change.

## What I verified
Summary of `VERIFICATION.md`: claims checked / confirmed / corrected / unverifiable; hands-on
setup attempts; the most important corrections and what changed in prompts/rules because of them.

## Setup
```bash
cp .env.example .env    # fill in keys
docker compose up -d    # local Postgres
npm install
npm run db:migrate
npm run db:seed         # generates the seed guides (takes a few minutes, costs API credits)
npm run dev
```

## Limitations
- Approval times are rarely published; many are marked Uncertain.
- Probes can't see inside authenticated consoles.
- JS-rendered docs may be partially read.
- Ambiguous names (e.g. "Teams") rely on the agent's assumption, shown to the user.
- No auth/accounts; rate-limited job creation.

## How this scales to 100+ apps
Scheduled re-checks via `next_check_at`, changelog/RSS watchers, feedback-triggered rechecks,
Redis-backed queue with workers, shared sources across guides, human review queue for
`needs_review` claims.
