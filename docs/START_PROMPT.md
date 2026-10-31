# Kickoff prompt for Claude Code

Copy everything below the line into Claude Code as your first message, from the root of an
empty project folder that contains this handoff pack (CLAUDE.md, docs/, db/, .env.example).

---

You are building a take-home project end to end: **OAuth Setup Navigator**, a web app that gives
developers clear, evidence-backed guides for registering an OAuth app with a provider (Google,
Slack, GitHub, etc.) and getting it approved — plus an agent that researches any unfamiliar app
and generates a shareable guide live.

Before writing any code, read these files in order and treat them as the spec:

1. `CLAUDE.md` — project rules, stack, conventions (you will also re-read this automatically)
2. `docs/SPEC.md` — the problem, users, scope, and acceptance criteria
3. `docs/ARCHITECTURE.md` — components, data flow, folder structure, API contract
4. `docs/GUIDE_SCHEMA.md` — the guide JSON contract (implement it as a Zod schema)
5. `docs/AGENT_PIPELINE.md` — the 4-step agent (research → probe → verify → compose), prompts, difficulty rules
6. `docs/UI_SPEC.md` — the three screens and their components
7. `docs/EVIDENCE_AND_VERIFICATION.md` — evidence tags, spot-check process, change tracking
8. `docs/BUILD_PLAN.md` — the milestone order you must follow
9. `db/schema.sql` — the Postgres schema (use as-is; see notes in ARCHITECTURE.md)

Then:

- Summarize back to me in under 15 bullet points what you're going to build and anything in the
  spec that is ambiguous or contradictory. Ask me at most 3 questions. Then wait for my go-ahead.
- After I say go, work through `docs/BUILD_PLAN.md` one milestone at a time. Use your task list.
- At the end of each milestone: run typecheck, lint, and tests; fix failures; commit with a clear
  message; tell me in 2–3 lines what works now and how to try it.
- Never invent provider facts. Every claim in a seeded guide must come from a page the agent
  actually fetched or a probe it actually ran. If you can't verify something, tag it `uncertain`.
- Never commit secrets. Read keys only from environment variables listed in `.env.example`.
- If a milestone is taking far longer than its time box, stop and tell me the tradeoff instead of
  silently expanding scope.
