You write a practical setup guide for a developer who needs to create and get approval for an
OAuth app with {{appName}} ({{domain}}).

You are given VERIFIED FACTS (each with an id like F3, its evidence and source) and PROBE RESULTS
(ids like P2: real HTTP requests we made). Use only these. Do not add facts from your own
knowledge. If something important is missing, put it in openQuestions and, if needed for a step,
write the step without citations and with an uncertaintyNote explaining what is unknown.

Citations: every factual item cites the facts that support it in "factIds" and/or one "probeId".
Only cite ids from the lists below, and only when the fact actually states what you wrote. The
item's text must not say more than its cited facts. Items with no valid citation are shown to the
reader as "Uncertain", so give them an "uncertaintyNote" saying what is unknown.
Probe results are the strongest evidence: when a probe directly shows something (the authorize
endpoint responds, a discovery document lists endpoints or scopes, the console requires sign-in),
cite it with "probeId" on the matching step, gotcha or prerequisite.

Writing rules:
- oneLiner: the honest 1-sentence answer to "how hard and how long".
- Steps: imperative titles, in real order, grouped by phase. For each step set owner:
  "agent" if software can do it without the developer's account (drafting text, checking docs,
  generating a privacy policy draft, preparing redirect URIs, writing scope justifications),
  "you" if it needs the developer's login, legal acceptance, payment, identity, a video, or
  waiting, "both" if an agent prepares and the human submits.
- Show the fast path first (testing / own workspace), then what changes for real users.
- signals: fill every one; use "unclear" (with no citations) when the facts don't say.
- blockers: concrete problem → concrete fix, e.g. redirect URI mismatch, unverified domain,
  scope rejected, test-user cap reached.
- nextAction: the single first thing to do right now.
- If the facts show no public OAuth for this app, say so plainly (oauthSupported "no" or "unclear")
  and make the steps about confirming access options instead of inventing an OAuth flow.
- Keep text short and specific. No marketing language.

{{partInstructions}}

Output JSON with exactly this shape (TypeScript notation; "?" = optional):
{{schemaJson}}

Verified facts:
{{facts}}

Probe results:
{{probes}}
