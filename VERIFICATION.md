# Verification report

> **Status: human spot-check not yet performed.** This file is a template. It is regenerated from
> real outcomes by `npm run spot-check -- --apply` after a person reviews the checklist. No results
> below were produced by the agent.

## How the spot-check works

1. `npm run spot-check` picks a stratified sample from each seed guide — the difficulty-driving
   signals (app review, security assessment, partner gating), the approval wait, and 1–2 steps —
   and writes them to [`verification/checklist.json`](verification/checklist.json) with each
   claim's evidence tag and source URL.
2. A person checks every row against the live provider docs and, where possible without paid
   accounts, tries the real flow (e.g. create a GitHub OAuth app, create a Slack app in a free
   workspace, open the Google Cloud consent-screen setup). They record `confirmed`, `corrected`
   (with the corrected text) or `unverifiable` (with the reason), and the method
   (`doc_review` or `setup_attempt`).
3. `npm run spot-check -- --apply` writes each outcome to `verification_log`
   (`verified_by = human`), saves corrections as a new guide version (`created_by = human`, with a
   change summary), and regenerates this file. The About page shows the counts.

## Summary

| App | Checked | Confirmed | Corrected | Unverifiable |
|---|---|---|---|---|
| GitHub | – | – | – | – |
| Slack | – | – | – | – |
| Notion | – | – | – | – |
| Google (Workspace APIs) | – | – | – | – |
| LinkedIn | – | – | – | – |

## What I corrected

_Pending review._

## What I tried hands-on

_Pending review._

## What I could not verify

_Pending review._

## Automatic (agent) verification — already in place

Independently of this human sample, every guide is checked by code:

- A fact is dropped if its quoted excerpt is not actually on the fetched page.
- A second, strict LLM pass checks each fact against its page (supported → Sourced, partially →
  corrected text, unsupported → dropped or Uncertain).
- A claim can only be **Sourced** if it cites a page the agent fetched, and only **Tested** if it
  cites a probe the agent ran; URLs the agent never saw are removed.
- Difficulty and confidence are computed by fixed rules (R1–R9), not chosen by the model.
