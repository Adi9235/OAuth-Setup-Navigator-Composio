import { createHash } from "node:crypto";

/** Collapse whitespace so cosmetic re-rendering of a page doesn't count as a change. */
export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** sha256 (hex) of normalized cleaned page text — the change-detection key for sources. */
export function contentHash(text: string): string {
  return createHash("sha256").update(normalizeText(text), "utf8").digest("hex");
}
