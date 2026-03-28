"use client";

import Link from "next/link";
import {
  Bot,
  FolderGit2,
  LayoutDashboard,
  Settings2,
  Workflow,
} from "lucide-react";
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
    <aside className="w-full rounded-[24px] border border-border/90 bg-panel/[0.78] p-3 lg:w-[280px]">
      <div className="mb-6 rounded-[20px] border border-border/80 bg-background/65 px-4 py-4">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-2xl border border-border/80 bg-panel/80 p-2.5">
            <Bot className="h-5 w-5 text-accent" />
          </div>
          <div>
            <p className="font-medium">Repo Butler</p>
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
              Issue pipeline
            </p>
          </div>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          Triage, reproduce, and verify without losing the maintainer audit
          trail.
        </p>
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
                "group flex items-start gap-3 rounded-[20px] border px-4 py-3 transition",
                active
                  ? "border-border bg-background/70"
                  : "border-transparent bg-transparent hover:border-border/80 hover:bg-background/50",
              )}
            >
              <div
                className={cn(
                  "rounded-2xl border p-2 transition",
                  active
                    ? "border-accent/30 bg-accent/10 text-accent"
                    : "border-border/80 bg-background/70 text-muted-foreground group-hover:text-accent",
                )}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <p className="font-medium">{item.title}</p>
                  {active ? (
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-accent"
                      aria-hidden="true"
                    />
                  ) : null}
                </div>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {item.description}
                </p>
              </div>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
