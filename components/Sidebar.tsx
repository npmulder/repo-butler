"use client";

import Link from "next/link";
import { Bot, FolderGit2, LayoutDashboard, Settings2, Workflow } from "lucide-react";
import { usePathname } from "next/navigation";

import { DASHBOARD_NAV_ITEMS } from "@/lib/constants";
import { cn } from "@/lib/utils";

const icons = {
  Overview: LayoutDashboard,
  Repos: FolderGit2,
  Runs: Workflow,
  Settings: Settings2,
} as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-full rounded-[28px] border border-border/80 bg-panel/90 p-4 lg:w-[280px]">
      <div className="mb-6 flex items-center gap-3 rounded-[22px] border border-border/80 bg-background/70 px-4 py-4">
        <div className="rounded-2xl border border-accent/20 bg-accent/10 p-2.5">
          <Bot className="h-5 w-5 text-accent" />
        </div>
        <div>
          <p className="font-medium">Repo Butler</p>
          <p className="text-sm text-muted-foreground">Issue triage pipeline</p>
        </div>
      </div>

      <nav className="space-y-2">
        {DASHBOARD_NAV_ITEMS.map((item) => {
          const Icon = icons[item.title];
          const active = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-start gap-3 rounded-[22px] border px-4 py-3 transition",
                active
                  ? "border-accent/30 bg-accent/10"
                  : "border-transparent bg-transparent hover:border-border/80 hover:bg-background/60",
              )}
            >
              <div className="rounded-2xl border border-border/80 bg-background/70 p-2">
                <Icon className="h-4 w-4 text-accent" />
              </div>
              <div className="min-w-0">
                <p className="font-medium">{item.title}</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.description}</p>
              </div>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
