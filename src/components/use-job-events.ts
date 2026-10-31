"use client";

import { useEffect, useState } from "react";
import type { JobEvent, JobSummary } from "@/lib/api-types";

/** Subscribes to /api/jobs/[id]/events. Events replay from the DB, so refresh is lossless. */
export function useJobEvents(jobId: string) {
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [final, setFinal] = useState<JobSummary | null>(null);
  const [connection, setConnection] = useState<"connecting" | "open" | "lost">("connecting");

  useEffect(() => {
    const seen = new Set<string>();
    const source = new EventSource(`/api/jobs/${jobId}/events`);
    source.onopen = () => setConnection("open");
    source.onerror = () => setConnection((c) => (c === "open" ? "lost" : c));
    source.addEventListener("job_event", (e) => {
      const ev = JSON.parse((e as MessageEvent<string>).data) as JobEvent;
      if (seen.has(ev.id)) return;
      seen.add(ev.id);
      setConnection("open");
      setEvents((prev) => [...prev, ev]);
    });
    source.addEventListener("end", (e) => {
      setFinal(JSON.parse((e as MessageEvent<string>).data) as JobSummary);
      source.close();
    });
    return () => source.close();
  }, [jobId]);

  return { events, final, connection };
}
