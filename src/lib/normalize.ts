// Input normalization (ARCHITECTURE.md §4): app name or URL -> registrable domain or name slug.
import { parse } from "tldts";

export const MAX_INPUT_LENGTH = 200;

export type NormalizedInput =
  | { kind: "domain"; raw: string; domain: string; slug: string }
  | { kind: "name"; raw: string; name: string; slug: string };

const PLAUSIBLE = /^[\p{L}\p{N}][\p{L}\p{N} .\-_/:?=&#%+~@()',]*$/u;
const HOST_PREFIXES = /^(?:www|developers?|api|docs|app)\./;

/** Lowercased kebab-case slug: "Google Drive" -> "google-drive". */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Registrable domain for a hostname or URL, e.g. "docs.github.com" -> "github.com". */
export function registrableDomain(hostOrUrl: string): string | null {
  let host = hostOrUrl.trim().toLowerCase();
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(host) ? host : `https://${host}`).hostname;
  } catch {
    return null;
  }
  while (HOST_PREFIXES.test(host)) host = host.replace(HOST_PREFIXES, "");
  const p = parse(host, { allowPrivateDomains: true });
  // Unknown suffixes ("next.js") are not domains.
  if (!p.domain || !(p.isIcann || p.isPrivate)) return null;
  return p.domain;
}

/** Returns null when the input isn't a plausible app name or URL. */
export function normalizeInput(input: string): NormalizedInput | null {
  const raw = input.trim().replace(/\s+/g, " ");
  if (!raw || raw.length > MAX_INPUT_LENGTH || !PLAUSIBLE.test(raw)) return null;
  const lower = raw.toLowerCase();

  const looksLikeUrl = /^[a-z][a-z0-9+.-]*:\/\//.test(lower) || (lower.includes(".") && !lower.includes(" "));
  if (looksLikeUrl) {
    const domain = registrableDomain(lower);
    if (domain) return { kind: "domain", raw, domain, slug: slugify(domain.split(".")[0]) };
    // An explicit scheme with no real domain is junk; "next.js"-style names fall through.
    if (lower.includes("://")) return null;
  }

  const slug = slugify(lower);
  if (!slug) return null;
  return { kind: "name", raw, name: raw, slug };
}

/**
 * Key stored in jobs.normalized_domain so the partial unique index dedupes active jobs.
 * Bare names have no domain yet, so they get a provisional "name:<slug>" key.
 */
export function jobDedupeKey(n: NormalizedInput): string {
  return n.kind === "domain" ? n.domain : `name:${n.slug}`;
}
