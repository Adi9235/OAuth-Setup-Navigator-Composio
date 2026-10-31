import type { Metadata } from "next";
import { SettingsForm } from "@/components/settings-form";

export const metadata: Metadata = { title: "API keys" };

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">API keys</h1>
        <p className="text-pretty text-muted-foreground">
          Generating a new guide needs an AI model and web search. Bring your own keys and pick the provider and model —
          browsing existing guides needs nothing.
        </p>
      </header>
      <SettingsForm />
    </div>
  );
}
