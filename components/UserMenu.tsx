"use client";

import { useState } from "react";
import { ChevronDown, LogOut } from "lucide-react";
import { useAuth } from "@workos-inc/authkit-nextjs/components";

export function UserMenu() {
  const [busy, setBusy] = useState(false);
  const { user, signOut } = useAuth();

  const label = user?.firstName ?? user?.email?.split("@")[0] ?? "Maintainer";

  return (
    <div className="flex items-center gap-3 rounded-full border border-border/80 bg-background/70 px-4 py-2.5">
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{label}</span>
        <span className="truncate text-xs text-muted-foreground">{user?.email ?? "repo-butler"}</span>
      </div>
      <ChevronDown className="h-4 w-4 text-muted-foreground" />
      <button
        type="button"
        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/80 text-muted-foreground transition hover:text-foreground"
        aria-label="Sign out"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await signOut({ returnTo: "/" });
          } finally {
            setBusy(false);
          }
        }}
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}
