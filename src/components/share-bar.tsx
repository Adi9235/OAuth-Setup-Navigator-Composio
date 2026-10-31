"use client";

import { Check, Download, Link2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { credentialsPayload } from "./api-settings";

export function ShareBar({ slug, allowRecheck = true }: { slug: string; allowRecheck?: boolean }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [recheck, setRecheck] = useState<"idle" | "starting" | "error">("idle");
  const [error, setError] = useState("");

  const copy = async () => {
    const url = `${window.location.origin}/guides/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link", url);
    }
  };

  const startRecheck = async () => {
    setRecheck("starting");
    setError("");
    try {
      const res = await fetch(`/api/guides/${slug}/recheck`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentials: credentialsPayload() }),
      });
      const data = (await res.json()) as { jobId?: string; error?: string };
      if (!res.ok || !data.jobId) throw new Error(data.error ?? "Could not start a re-check");
      router.push(`/jobs/${data.jobId}`);
    } catch (err) {
      setRecheck("error");
      setError(err instanceof Error ? err.message : "Could not start a re-check");
    }
  };

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={copy}>
          {copied ? <Check aria-hidden /> : <Link2 aria-hidden />} {copied ? "Copied" : "Copy link"}
        </Button>
        <Button variant="outline" size="sm" nativeButton={false} render={<a href={`/api/guides/${slug}.md`} download={`${slug}-oauth-guide.md`} />}>
          <Download aria-hidden /> Export Markdown
        </Button>
        {allowRecheck && (
          <Button variant="outline" size="sm" onClick={startRecheck} disabled={recheck === "starting"}>
            <RefreshCw aria-hidden className={recheck === "starting" ? "animate-spin" : ""} /> Re-check
          </Button>
        )}
      </div>
      {error && <p role="alert" className="text-xs text-hard">{error}</p>}
    </div>
  );
}
