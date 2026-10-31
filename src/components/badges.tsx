// Small labelled badges. Color always comes with a text label (UI_SPEC).
import { cn } from "cn";
import type { Difficulty, Owner } from "@/lib/guide-schema";
import { OWNER_LABEL } from "@/lib/format";

const DIFFICULTY_STYLE: Record<Difficulty, string> = {
  easy: "text-easy bg-easy/10 ring-easy/30",
  medium: "text-medium bg-medium/10 ring-medium/30",
  hard: "text-hard bg-hard/10 ring-hard/30",
};
const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };

export function DifficultyBadge({ difficulty, size = "sm" }: { difficulty: Difficulty; size?: "sm" | "lg" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-medium ring-1 ring-inset",
        DIFFICULTY_STYLE[difficulty],
        size === "lg" ? "px-3 py-1 text-base" : "px-2 py-0.5 text-xs",
      )}
    >
      <span aria-hidden className={cn("rounded-full bg-current", size === "lg" ? "size-2.5" : "size-1.5")} />
      {DIFFICULTY_LABEL[difficulty]}
    </span>
  );
}

const OWNER_STYLE: Record<Owner, string> = {
  agent: "text-agent bg-agent/10 ring-agent/30",
  you: "text-foreground bg-muted ring-border",
  both: "text-agent bg-gradient-to-r from-agent/10 to-muted ring-agent/30",
};

export function OwnerChip({ owner }: { owner: Owner }) {
  return (
    <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", OWNER_STYLE[owner])}>
      {OWNER_LABEL[owner]}
    </span>
  );
}

export function ConfidenceChip({ confidence }: { confidence: "high" | "medium" | "low" }) {
  return (
    <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground ring-1 ring-inset ring-border">
      {confidence[0].toUpperCase() + confidence.slice(1)} confidence
    </span>
  );
}
