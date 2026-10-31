"use client";

import { useEffect, useState } from "react";
import { cn } from "cn";
import { relativeTime } from "@/lib/format";

/** "Verified 2 days ago" (ISO in tooltip) · "Re-checking" · "May be outdated". */
export function FreshnessBadge({
  freshness,
  lastVerifiedAt,
  compact = false,
}: {
  freshness: "fresh" | "rechecking" | "outdated";
  lastVerifiedAt: string | null;
  compact?: boolean;
}) {
  // Relative time depends on "now": render it after mount to avoid hydration mismatches.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);

  if (freshness === "rechecking")
    return <span className="inline-flex items-center gap-1 text-xs text-tested">↻ Re-checking</span>;
  if (freshness === "outdated")
    return <span className="inline-flex items-center gap-1 text-xs text-uncertain">⚠ May be outdated</span>;
  if (!lastVerifiedAt) return null;
  return (
    <time
      dateTime={lastVerifiedAt}
      title={lastVerifiedAt}
      className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground")}
    >
      <span aria-hidden className="text-easy">✓</span>
      {compact ? "" : "Verified "}
      {now ? relativeTime(lastVerifiedAt, now) : lastVerifiedAt.slice(0, 10)}
    </time>
  );
}
