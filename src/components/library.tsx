"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { cn } from "cn";
import type { GuideCard as Card } from "@/lib/db/guides";
import { formatDays, formatMinutes } from "@/lib/format";
import type { Difficulty } from "@/lib/guide-schema";
import { DifficultyBadge } from "./badges";
import { FreshnessBadge } from "./freshness-badge";

const FILTERS: (Difficulty | "all")[] = ["all", "easy", "medium", "hard"];

export function GuideCard({ card }: { card: Card }) {
  return (
    <Link
      href={`/guides/${card.slug}`}
      className="group flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs transition hover:border-foreground/30 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-semibold group-hover:underline">{card.name}</h3>
          <p className="truncate text-xs text-muted-foreground">{card.domain}</p>
        </div>
        <DifficultyBadge difficulty={card.difficulty} />
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Hands-on</dt>
          <dd className="font-medium tabular-nums">{formatMinutes(card.handsOnMinutes)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Approval wait</dt>
          <dd className="font-medium tabular-nums">{formatDays(card.approvalWaitDays)}</dd>
        </div>
      </dl>
      <p className="line-clamp-2 text-sm text-muted-foreground">{card.oneLiner}</p>
      <div className="mt-auto flex items-center justify-between pt-1">
        <FreshnessBadge freshness={card.freshness} lastVerifiedAt={card.lastVerifiedAt} compact />
        <span className="text-xs text-muted-foreground">{card.confidence} confidence</span>
      </div>
    </Link>
  );
}

export function Library({ cards }: { cards: Card[] }) {
  const [filter, setFilter] = useState<Difficulty | "all">("all");
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return cards.filter(
      (c) => (filter === "all" || c.difficulty === filter) && (!needle || c.name.toLowerCase().includes(needle) || c.domain.includes(needle)),
    );
  }, [cards, filter, q]);

  return (
    <section aria-labelledby="library-title">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="library-title" className="text-lg font-semibold tracking-tight">Library</h2>
          <div role="group" aria-label="Filter by difficulty" className="flex rounded-lg border p-0.5">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={cn("rounded-md px-2.5 py-1 text-sm capitalize", filter === f ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground")}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <label className="sr-only" htmlFor="library-filter">Filter guides</label>
        <input
          id="library-filter"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter…"
          className="h-9 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-48"
        />
      </div>
      {shown.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((c) => <GuideCard key={c.slug} card={c} />)}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {cards.length ? "No guides match this filter." : "No guides yet — search for an app above to generate the first one."}
        </p>
      )}
    </section>
  );
}
