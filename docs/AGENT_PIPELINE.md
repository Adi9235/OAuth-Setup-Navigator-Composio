# AGENT PIPELINE

`src/server/agent/pipeline.ts` runs four steps in order. Each step emits job events
(`step`, `level`, `message`, optional `payload`) so the live page can show progress, and writes
its results to the DB before the next step starts (so a crash loses at most one step).

Time budget per job: ~3 minutes total. Hard cap 5 minutes → fail with a clear event.

---

## Step 0 — Identify (inside research)
Goal: confirm what app the user means and its primary domain.
- Tavily search: `"<input> developer API OAuth"`; take the top official-looking domain.
- LLM call (small): given input + top 5 results (title, url, snippet) → `{ name, domain,
  developerPortalUrl?, confidence }`. If confidence is low or several apps match, emit a `warn`
  event naming the assumption ("Assuming you meant Zoom (zoom.us)").
- Re-check DB for an existing app with this domain → if found, finish job by pointing to it.
- Insert `apps` row (slug from name; dedupe slug with `-2` suffix if needed).

Events: "Identifying the app…" → "Found Zoom (zoom.us) ✓"

## Step 1 — Research
Goal: collect the pages that answer the guide questions.

Queries (run in parallel, max 5 results each, prefer the provider's own domains):
1. `<name> create OAuth app`
2. `<name> OAuth app review OR verification OR approval`
3. `<name> OAuth scopes list`
4. `<name> developer terms partner program API access`
5. `<name> marketplace OR app directory publish requirements`
6. `<name> OAuth redirect URI requirements`

Then:
- Rank URLs: provider domain / docs subdomains first, then official forums/changelogs, then
  others. Fetch the top 8–12 (max 3 concurrent, 15s timeout). Clean with Readability → text.
- For each page: compute sha256 of cleaned text, upsert `sources` + `source_snapshots`.
- **Extract** (LLM, one call per page, run in parallel, page text truncated to ~12k tokens):
  prompt `prompts/extract.md` → list of candidate facts, each with `field`, `text`,
  `supportingExcerpt` (≤ 300 chars, copied from the page), `url`.
- Merge candidates across pages (dedupe by field + similar text).

Events: "Searching developer docs…" → "Reading 9 pages…" → "Extracted 31 candidate facts ✓"

## Step 2 — Probe (the "tested" evidence)
Read-only, unauthenticated GETs. Never log in, never submit forms. Store each in `probe_runs`.
1. **OIDC discovery:** `https://<domain>/.well-known/openid-configuration` and any issuer found
   in docs (e.g. `accounts.google.com`). Record `authorization_endpoint`, `token_endpoint`,
   `scopes_supported` if present.
2. **OAuth AS metadata:** `/.well-known/oauth-authorization-server`.
3. **Authorize endpoint:** GET the authorize URL found in docs/metadata with a dummy
   `client_id=probe_invalid` and `response_type=code`. Expected: 4xx or an error page. This
   proves the endpoint exists and is live. Record status + redirect location (don't follow into
   login forms beyond the first redirect).
4. **Developer console URL:** GET it; record whether it redirects to a sign-in page (→ claim:
   "Console requires sign-in with a <name> account", tested).
5. **Docs pages:** confirm key cited URLs return 200 (catches dead links).

A probe produces `tested` claims only for what it directly observed (endpoint exists, metadata
lists X scopes, console needs login). It never proves approval timelines or review rules.

Events: "Checking OAuth endpoints…" → "Authorize endpoint live ✓" / "No discovery document (ok)"

## Step 3 — Verify
Goal: make sure each extracted fact is really supported by its source.
- For every candidate fact with a URL: LLM call with `prompts/verify.md` given the fact and the
  relevant page section (find by excerpt; fall back to the first 6k tokens).
  Output `{ verdict: "supported" | "partially" | "unsupported", correctedText?, reason }`.
- `supported` → `sourced`. `partially` → use `correctedText`, `sourced`. `unsupported` → drop
  it, or keep as `uncertain` with `uncertaintyNote` if it's important (e.g. approval time).
- Facts only from non-official sources → max evidence `sourced` but mark source `official=false`,
  and the UI shows "community source".
- Write a `verification_log` row per fact (`verified_by=agent`, `method=doc_review`).

Events: "Verifying 31 facts against sources…" → "27 confirmed, 2 corrected, 2 unverifiable ✓"

## Step 4 — Compose
1. LLM call with `prompts/compose.md`: verified facts + probes → `Guide` JSON **without**
   `summary.difficulty`, `difficultyReasons`, `confidence` (code fills those).
2. Zod-validate; on failure retry once with the errors appended.
3. Post-check: every `sources[].url` in claims must be in the set of fetched URLs; every
   `probeId` must exist. Downgrade violators to `uncertain`.
4. Compute difficulty + confidence (below). Insert `guides` (if new), `guide_versions`,
   `claims`, `claim_sources`. Set `guides.current_version_id`, `status=published`,
   `last_verified_at=now()`, `next_check_at = now() + check_interval_days`.
5. Emit section events as they're ready so the UI fills progressively (`payload.section`).

Events: "Writing the guide…" → "Guide ready ✓" (payload `{ slug }`)

---

## Difficulty rules (`difficulty.ts`) — deterministic, unit-tested
Evaluate in order; collect every rule that fires as a reason.

| Rule | Condition (from `signals`) | Effect |
|---|---|---|
| R1 | `selfServeRegistration = no` OR `partnerOrApplication = yes` | **hard** |
| R2 | `securityAssessment = yes` or `conditional` | **hard** |
| R3 | `paidPlanRequired = yes` | at least **medium**; **hard** if combined with any review |
| R4 | `reviewRequired = always` | at least **medium** |
| R5 | `reviewRequired = for_sensitive_scopes` or `for_public_distribution` | at least **medium** |
| R6 | `businessVerification = yes` | at least **medium** |
| R7 | `partnerOrApplication = for_some_apis` | at least **medium** |
| R8 | none of the above | **easy** |
| R9 | ≥3 signals `unclear` | keep computed level but force `confidence = low` and add reason "Several requirements could not be confirmed" |

Note R5: a provider where *basic* use is instant but *public* use needs review is **medium** —
the guide must show both paths ("for testing / your own workspace" vs "for real users").

Approval wait defaults if no source gives a number: none → 0–0 days; review → `uncertain` claim
"Review time not published" with range from community sources if any, else 1–30 days marked
`uncertain`. Never present an unsourced number as fact.

---

## Prompts
Store in `src/server/agent/prompts/*.md`. Load at runtime; interpolate with `{{var}}`.

### extract.md
```
You extract facts about registering an OAuth app with {{appName}} from ONE web page.

Return JSON: { "facts": [ { "field": <one of the fields below>, "text": <one plain sentence>,
"supportingExcerpt": <verbatim text from the page, max 300 characters>, "scope"?: string,
"tier"?: "basic"|"sensitive"|"restricted" } ] }

Fields: self_serve_registration, review_required, review_time, security_assessment,
partner_or_application, paid_plan_required, business_verification, domain_or_privacy_policy,
redirect_uri_rules, scope, test_mode_limits, token_lifetime, console_url, setup_step,
common_rejection_reason, other_gotcha.

Rules:
- Only state what THIS page says. No outside knowledge. If the page says nothing relevant,
  return { "facts": [] }.
- supportingExcerpt must be copied exactly from the page.
- Prefer concrete details (numbers, names of programs, exact requirement names).
- setup_step facts should be one action each, in the page's order.

Page URL: {{url}}
Page text:
<<<
{{pageText}}
>>>
```

### verify.md
```
Check whether a claim is supported by the source text.

Claim: {{claim}}
Source URL: {{url}}
Source text:
<<<
{{section}}
>>>

Return JSON: { "verdict": "supported"|"partially"|"unsupported",
"correctedText"?: <claim rewritten to match the source exactly, only if partially>,
"reason": <one sentence> }

"supported" = the source states this directly. "partially" = the source supports a narrower or
different version. "unsupported" = the source doesn't say this. Be strict: inferences, generalizations,
and numbers not in the text are not supported.
```

### compose.md
```
You write a practical setup guide for a developer who needs to create and get approval for an
OAuth app with {{appName}} ({{domain}}).

You are given VERIFIED FACTS (each with evidence and sources) and PROBE RESULTS. Use only these.
Do not add facts from your own knowledge. If something important is missing, put it in
openQuestions and, if needed for a step, write the step with evidence "uncertain" and an
uncertaintyNote explaining what is unknown.

Output JSON matching the Guide schema (provided below), EXCEPT leave out summary.difficulty,
summary.difficultyReasons and summary.confidence.

Writing rules:
- oneLiner: the honest 1-sentence answer to "how hard and how long".
- Steps: imperative titles, in real order, grouped by phase. For each step set owner:
  "agent" if software can do it without the developer's account (drafting text, checking docs,
  generating a privacy policy draft, preparing redirect URIs, writing scope justifications),
  "you" if it needs the developer's login, legal acceptance, payment, identity, a video, or
  waiting, "both" if an agent prepares and the human submits.
- Show the fast path first (testing / own workspace), then what changes for real users.
- signals: fill every one; use "unclear" with evidence "uncertain" when the facts don't say.
- blockers: concrete problem → concrete fix, e.g. redirect URI mismatch, unverified domain,
  scope rejected, test-user cap reached.
- nextAction: the single first thing to do right now.
- Keep text short and specific. No marketing language.

Guide schema:
{{schemaJson}}

Verified facts:
{{facts}}

Probe results:
{{probes}}
```
