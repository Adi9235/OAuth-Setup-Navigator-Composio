# SPEC — OAuth Setup Navigator

## 1. The problem (in plain words)
A developer building an AI agent wants their users to connect an app (Gmail, Slack, Notion...).
To do that they must first register an **OAuth app** with that provider (get a Client ID/Secret,
set redirect URIs, choose scopes) and sometimes get it **reviewed/approved**.

Every provider does this differently. Some take 5 minutes (GitHub). Some need a review (Slack
Marketplace). Some need domain verification, a privacy policy, a demo video and possibly a
third-party security assessment for sensitive scopes (Google). Some are gated behind partner
programs or paid plans. Developers can't tell upfront whether setup takes an hour or weeks.

## 2. Three layers to keep straight
1. **Provider OAuth app** — registered once by the developer with the provider. Produces client
   credentials, redirect URIs, scopes, consent-screen branding, review status.
2. **Developer's integration** — their code runs the OAuth flow using those credentials.
3. **User connections** — each end user clicks "Allow"; the integration stores their tokens.

This product is only about layer 1: getting the provider OAuth app created and approved.
Reference for context: https://docs.composio.dev/toolkits/managed-auth (managed OAuth apps exist
so developers can skip layer 1 at first; serious products usually need their own app later).

## 3. Users
- **Developer / agent builder** — wants to know "how hard, how long, what do I need, what next".
- **Teammate / PM** receiving a shared link — wants the summary in 10 seconds.

## 4. What a guide must answer
| Question | Guide field |
|---|---|
| How hard is it? | `difficulty` + reasons (computed by rules) |
| How long? | hands-on time range + approval wait range |
| What do I need first? | `prerequisites` (domain, privacy policy, business entity, paid plan...) |
| What are the steps? | ordered `steps`, each with owner (agent / you / both) |
| What can block me? | `gotchas` and `blockers` with fixes |
| What can an agent do vs. me? | owner on each step + "agent can / you must" summary |
| How do I know it's true? | evidence tag + source URL / probe on every claim, last-verified date |

## 5. Scope for the take-home (6–8 hours)
**In scope**
- Library of **5 seed guides** chosen to cover different setup challenges:
  | App | Why it's in the set |
  |---|---|
  | GitHub | Self-serve, minutes, no review — the easy baseline |
  | Slack | Fast to create; distribution/Marketplace adds review |
  | Notion | Public vs. internal integration distinction |
  | Google (Gmail scopes) | Verification, sensitive/restricted scopes, possible security assessment — hard |
  | LinkedIn | Product/partner-gated API access |
  Final difficulty for each must come from the agent's evidence + rules, not from this table.
- **Live generation:** submit any app name or URL → agent researches → guide streams in → saved
  to library with a shareable URL.
- Evidence tags on every claim; sources list; last-verified date.
- "Re-check this guide" button (re-fetch sources, compare hashes, re-verify changed claims).
- Spot-check report: a `VERIFICATION.md` + a page section showing what was confirmed, corrected,
  or unverifiable for a sample of claims.
- Export guide as Markdown; copy share link.

**Out of scope (describe in README as next steps)**
- All 100 guides; scheduled cron re-checks; changelog/RSS watching; user accounts; auth;
  actually completing provider registrations; Redis queue; feedback analytics.

## 6. Acceptance criteria
1. Home page lists seed guides with difficulty badge, hands-on time, approval wait.
2. Submitting "github", "github.com" or "https://github.com/settings" resolves to the same app.
3. Submitting an unknown app (e.g. "Airtable", "Zoom", "Calendly") starts a job and shows live
   step-by-step progress within 2 seconds; a complete guide appears in under ~3 minutes.
4. Refreshing the live page mid-job replays progress (events come from DB, not memory).
5. Two simultaneous submissions of the same unknown app share one job.
6. Every claim in every guide has an evidence tag; every `sourced` claim links to a URL that was
   actually fetched; every `tested` claim links to a probe run.
7. Difficulty is reproducible: same evidence → same difficulty, explained by listed reasons.
8. Guide pages are shareable at `/guides/[slug]` and render without JS errors on mobile width.
9. If the agent can't find OAuth info (app has no public OAuth), the guide says so clearly
   instead of inventing steps.
10. README explains setup, key decisions, what was verified, and limitations.
