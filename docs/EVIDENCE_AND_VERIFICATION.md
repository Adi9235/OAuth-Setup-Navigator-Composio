# EVIDENCE, VERIFICATION & CHANGE TRACKING

## Evidence tags
| Tag | Meaning | Required link |
|---|---|---|
| **Tested** | The agent directly observed it with a probe (endpoint responded, metadata listed scopes, console redirects to sign-in) | `probe_runs` row |
| **Sourced** | A fetched page states it; a second LLM pass confirmed the page supports it | ≥1 `sources` row + excerpt |
| **Uncertain** | Inferred, conflicting, community-only with low agreement, or missing | `uncertaintyNote` explaining why |

A claim never gets upgraded without new evidence. Community sources are labeled as such.

## Spot-check (deliverable for the reviewers)
Script: `scripts/spot-check.ts`.
1. Pick a stratified sample: for each seed guide, 5 claims — always include difficulty-driving
   signals (review, security assessment, partner gating), approval time, and 1–2 steps.
2. For each claim, produce a checklist row with the claim, its evidence, and source URL.
3. **Human (you, the developer) reviews** each row against the live docs — and, where possible
   without paid accounts, tries the real flow (e.g. create a GitHub OAuth app; create a Slack app
   in a free workspace; open Google Cloud console consent-screen setup). Record outcome:
   `confirmed`, `corrected` (with original + corrected text), or `unverifiable` (why).
4. Write results to `verification_log` (`verified_by=human`, method `doc_review` or
   `setup_attempt`) and generate `VERIFICATION.md`:
   - Summary table: claims checked, confirmed, corrected, unverifiable, per app
   - "What I corrected" list (agent said X → docs say Y → fix applied, and whether a prompt or
     rule change was made to prevent it)
   - "What I tried hands-on" list with outcomes
   - "What I could not verify" list
5. Apply corrections as a new guide version with `created_by=human` and a `change_summary`.

Claude Code: build the script and the empty `VERIFICATION.md` template; the human fills in
outcomes. Do NOT fabricate verification results.

## Change tracking (re-check)
On `recheck` jobs:
1. For each source of the current version: re-fetch, clean, hash.
   Same hash → update `last_fetched_at`. 404/410 → mark linked claims `needs_review`.
2. Changed hash → store new snapshot, compute text diff (use `diff` package, limit to changed
   paragraphs), LLM: "Given this diff and these dependent claims, which claims are affected and
   how? Return impact none|minor|breaking."
3. Re-run Verify on affected claims against the new snapshot; re-run all probes.
4. If anything changed → new guide version (copy unchanged claims, replace affected),
   `change_summary` like "Slack docs changed the review page: updated review time claim".
   Write `change_events`. Recompute difficulty.
5. Update `guides.freshness` (`fresh` / `outdated` if unresolved breaking issues) and
   `last_verified_at`.

Future (README only): scheduled cron using `guides.next_check_at`, shorter intervals for hard
apps, changelog/RSS watchers per provider, feedback threshold triggering recheck.
