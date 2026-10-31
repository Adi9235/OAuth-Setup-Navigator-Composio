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
- review_required: also capture what the page says about WHEN review applies or does not apply
  (e.g. "the app can be used immediately after registration", "only Marketplace listings are
  reviewed", "apps for your own workspace need no approval") — only if the page states it.
- paid_plan_required / partner_or_application: capture explicit statements either way
  (e.g. "available on all plans", "free for developers", "requires a partner agreement").
- Return at most 25 facts; prefer the ones about registration, review, and requirements.

Page URL: {{url}}
Page text:
<<<
{{pageText}}
>>>
