import { KeyRound } from "lucide-react";
import Link from "next/link";
import { ThemeToggle } from "./theme-toggle";

export function SiteHeader() {
  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span aria-hidden className="grid size-6 place-items-center rounded-md bg-foreground text-[11px] font-bold text-background">
            OA
          </span>
          OAuth Setup Navigator
        </Link>
        <nav aria-label="Site" className="flex items-center gap-1 text-sm">
          <Link href="/about" className="rounded-md px-2 py-1.5 text-muted-foreground hover:text-foreground">
            About
          </Link>
          <Link href="/settings" className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-muted-foreground hover:text-foreground">
            <KeyRound className="size-4" aria-hidden />
            <span className="hidden sm:inline">API keys</span>
            <span className="sr-only sm:hidden">API keys</span>
          </Link>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
