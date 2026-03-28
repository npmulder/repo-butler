import { Bell } from "lucide-react";

import { UserMenu } from "./UserMenu";

export function Header({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <header className="flex flex-col gap-4 rounded-[24px] border border-border/90 bg-panel/[0.78] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.26em] text-muted-foreground">
          Dashboard
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          {subtitle}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border/80 bg-background/70 text-muted-foreground transition hover:border-white/15 hover:bg-white/[0.04] hover:text-foreground"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
        </button>
        <UserMenu />
      </div>
    </header>
  );
}
