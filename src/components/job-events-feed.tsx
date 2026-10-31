"use client";

import { useEffect, useState } from "react";
import type { JobEvent, JobSummary } from "@/lib/api-types";

/** Subscribes to /api/jobs/[id]/events. Events replay from the DB, so refresh is lossless. */
export function useJobEvents(jobId: string) {
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [final, setFinal] = useState<JobSummary | null>(null);

  useEffect(() => {
    const seen = new Set<string>();
    const source = new EventSource(`/api/jobs/${jobId}/events`);
    source.addEventListener("job_event", (e) => {
      const ev = JSON.parse((e as MessageEvent<string>).data) as JobEvent;
      if (seen.has(ev.id)) return;
      seen.add(ev.id);
      setEvents((prev) => [...prev, ev]);
    });
    source.addEventListener("end", (e) => {
      setFinal(JSON.parse((e as MessageEvent<string>).data) as JobSummary);
      source.close();
    });
    return () => source.close();
  }, [jobId]);

  return { events, final };
}

export function JobEventsFeed({ jobId }: { jobId: string }) {
  const { events, final } = useJobEvents(jobId);
  return (
    <div>
      <ol aria-live="polite" className="space-y-1 font-mono text-sm">
        {events.map((e) => (
          <li key={e.id} className={e.level === "error" ? "text-red-600" : e.level === "warn" ? "text-amber-600" : ""}>
            <span className="text-muted-foreground">[{e.step}]</span> {e.message}
          </li>
        ))}
      </ol>
      {final && <p className="mt-4 text-sm">Job {final.status}.</p>}
    </div>
  );
}
