// Prompt templates live in ./prompts/*.md; loaded at runtime and interpolated with {{var}}.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type PromptName = "research" | "extract" | "verify" | "compose" | "impact";

const cache = new Map<PromptName, string>();

export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in vars)) throw new Error(`Missing prompt variable: ${key}`);
    return vars[key];
  });
}

export function renderPrompt(name: PromptName, vars: Record<string, string>): string {
  let template = cache.get(name);
  if (!template) {
    template = readFileSync(join(process.cwd(), "src", "server", "agent", "prompts", `${name}.md`), "utf8");
    cache.set(name, template);
  }
  return interpolate(template, vars);
}
