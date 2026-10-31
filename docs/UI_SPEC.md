# UI SPEC

Principles: answer "how bad is this?" in 5 seconds; everything else is one scroll away.
Clean, calm, developer-tool look (think Linear / Vercel docs). Light + dark mode. Mobile-first
(works at 375px). No modals for core flows. Keyboard friendly: `/` focuses search.

Color meaning (use consistently, always paired with a text label, never color alone):
- Difficulty: easy = green, medium = amber, hard = red
- Evidence: tested = blue "Tested", sourced = gray "Sourced", uncertain = amber dashed "Uncertain"
- Owner: agent = purple "Agent", you = neutral "You", both = "Agent + You"

---

## Screen 1 — Home `/`
```
┌──────────────────────────────────────────────────────────────┐
│ OAuth Setup Navigator                          About · GitHub │
│                                                              │
│   How hard is it to get an OAuth app approved?               │
│   [ Enter an app name or website…            ] [ Get guide ] │
│   Try: Slack · Google · Airtable · zoom.us                   │
│                                                              │
│   Library   [All] [Easy] [Medium] [Hard]      filter: [____] │
│   ┌────────────┐ ┌────────────┐ ┌────────────┐               │
│   │ GitHub     │ │ Slack      │ │ Google     │               │
│   │ ● Easy     │ │ ● Medium   │ │ ● Hard     │               │
│   │ 15–30 min  │ │ 1–2 h      │ │ 2–6 h      │               │
│   │ No review  │ │ Review:... │ │ Review:... │               │
│   │ ✓ 2d ago   │ │ ✓ 2d ago   │ │ ⚠ recheck  │               │
│   └────────────┘ └────────────┘ └────────────┘               │
└──────────────────────────────────────────────────────────────┘
```
- Submit → `POST /api/resolve` → navigate to guide or start job. Show inline spinner on button.
- Empty / invalid input → inline error "Enter an app name or URL".
- "Try:" chips fill and submit.
- Cards link to `/guides/[slug]`; show difficulty, hands-on range, approval wait, freshness.

## Screen 2 — Guide `/guides/[slug]`
Top to bottom:
1. **Header:** app name + domain, freshness badge ("Verified 2 days ago" / "Re-checking" /
   "May be outdated"), confidence chip, share bar (Copy link · Export Markdown · Re-check).
2. **Summary card** (the 5-second answer): big difficulty badge; three stats — Hands-on time,
   Approval wait, Cost; the oneLiner; "Why this rating" expandable list of difficultyReasons.
3. **Start here:** `nextAction` as a highlighted callout with the console link button.
4. **Who does what:** two columns — "An agent can do" / "You must do".
5. **Before you start:** prerequisites checklist.
6. **Steps:** grouped by phase (Prepare → Create → Configure → Test → Submit for review → Go live).
   Each step: checkbox (progress saved in localStorage per slug, wrapped in try/catch),
   title, owner chip, evidence badge, short text, "Open console" link if `url`,
   collapsible "Agent can help with…" / "You must…" lines, "This didn't work" feedback link.
   Show progress bar "4 of 11 done".
7. **Scopes** (if any): table scope / tier / evidence.
8. **Gotchas & blockers:** cards "Problem → Fix".
9. **Open questions:** what the agent couldn't confirm (always visible, honest).
10. **Evidence & sources:** list of sources (official vs community), probes run with outcome,
    and evidence mix bar ("18 sourced · 4 tested · 3 uncertain").
11. **Version history:** list of versions with change_summary.

Evidence badge hover/tap → popover with source title + URL + excerpt, or probe details, or the
uncertainty note. This is the core trust feature; make it fast and obvious.

## Screen 3 — Live generation `/jobs/[id]`
```
Researching Airtable…
 ✓ Identified Airtable (airtable.com)
 ✓ Searched developer docs — 11 results
 ✓ Read 9 pages
 ● Checking OAuth endpoints…         (spinner)
 ○ Verifying facts
 ○ Writing guide
 [ live log ▾ ]   elapsed 0:48
```
- Steps from `job_events.step`; each step shows its latest message; `warn` events in amber
  (e.g. assumption about which app); `error` shows a retry button.
- As compose emits sections, render the guide preview below the progress list, filling in.
- On success: confetti-free; just "Guide ready" + "Open shareable page" + copy link.
- Refresh mid-job replays from DB (no lost state). If the job finished already, redirect to guide.
- If `oauthSupported = no`: show a clear result "No public OAuth found for X" with what was
  checked and suggestions (API keys? partner program?).

## About page `/about`
How guides are made (4 steps), what each evidence tag means, difficulty rules table,
and the spot-check results (render `VERIFICATION.md` content or the verification_log summary).

## Components to build (shadcn/ui based)
SearchBox, GuideCard, DifficultyBadge, EvidenceBadge (+popover), FreshnessBadge, SummaryCard,
NextActionCallout, OwnerSplit, StepChecklist, ScopeTable, BlockerCard, SourcesList, ProbeList,
EvidenceMixBar, ShareBar, JobProgress, VersionHistory.

## Accessibility
Semantic headings; all badges have text; focus rings visible; color contrast AA; checkboxes are
real inputs with labels; SSE updates announced via `aria-live="polite"` on the progress list.
