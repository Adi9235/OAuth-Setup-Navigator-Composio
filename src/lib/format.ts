// Display helpers shared by UI and Markdown export.
import type { Owner, Phase, Range } from "./guide-schema";

export function formatMinutes(r: Range): string {
  if (r.max < 120) return r.min === r.max ? `${r.min} min` : `${r.min}–${r.max} min`;
  const h = (m: number) => (m / 60 >= 10 ? Math.round(m / 60) : Math.round(m / 6) / 10);
  return r.min === r.max ? `${h(r.min)} h` : `${h(r.min)}–${h(r.max)} h`;
}

export function formatDays(r: Range): string {
  if (r.max === 0) return "No review";
  if (r.max < 1) return "Under a day";
  return r.min === r.max ? `${r.max} day${r.max === 1 ? "" : "s"}` : `${r.min}–${r.max} days`;
}

/** "3 days ago" style; `now` injectable for tests. */
export function relativeTime(iso: string, now = Date.now()): string {
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  const units: [number, string][] = [[60, "minute"], [3600, "hour"], [86400, "day"], [2592000, "month"], [31536000, "year"]];
  let label = "minute";
  let value = Math.round(s / 60);
  for (const [secs, name] of units) {
    if (s >= secs) {
      label = name;
      value = Math.round(s / secs);
    }
  }
  return `${value} ${label}${value === 1 ? "" : "s"} ago`;
}

export const PHASES: Phase[] = ["prepare", "create", "configure", "test", "submit_review", "go_live"];

export const PHASE_LABEL: Record<Phase, string> = {
  prepare: "Prepare",
  create: "Create",
  configure: "Configure",
  test: "Test",
  submit_review: "Submit for review",
  go_live: "Go live",
};

export const OWNER_LABEL: Record<Owner, string> = { agent: "Agent", you: "You", both: "Agent + You" };

export const SIGNAL_TITLE: Record<string, string> = {
  selfServeRegistration: "Self-serve registration",
  reviewRequired: "App review",
  securityAssessment: "Security assessment",
  partnerOrApplication: "Partner program / application",
  paidPlanRequired: "Paid plan",
  businessVerification: "Business verification",
  domainOrPrivacyPolicy: "Domain / privacy policy",
};

export const SIGNAL_VALUE_LABEL: Record<string, string> = {
  yes: "Yes",
  no: "No",
  unclear: "Unclear",
  none: "None",
  for_public_distribution: "For public distribution",
  for_sensitive_scopes: "For sensitive scopes",
  always: "Always",
  conditional: "Conditional",
  for_some_apis: "For some APIs",
  for_some_features: "For some features",
  for_review: "For review",
};
