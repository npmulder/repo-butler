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
    <header className="flex flex-col gap-4 rounded-[28px] border border-border/80 bg-panel/90 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-muted-foreground">
          Dashboard
        </p>
        <h1 className="mt-2 text-2xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-border/80 bg-background/70 text-muted-foreground transition hover:text-foreground"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
        </button>
        <UserMenu />
      </div>
    </header>
  );
}
