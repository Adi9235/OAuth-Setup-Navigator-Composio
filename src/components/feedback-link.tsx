"use client";

import { useState } from "react";

/** "This didn't work" — posts step feedback (POST /api/feedback). */
export function FeedbackLink({ slug, claimId }: { slug: string; claimId?: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const send = async () => {
    setState("sending");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, claimId, kind: "step_failed" }),
      });
      setState(res.ok ? "sent" : "error");
    } catch {
      setState("error");
    }
  };
  if (state === "sent") return <span className="text-muted-foreground">Thanks — reported</span>;
  return (
    <button type="button" onClick={send} disabled={state === "sending"} className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
      {state === "error" ? "Couldn't send — retry" : "This didn't work"}
    </button>
  );
}
