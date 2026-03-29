"use client";

import { useEffect, useState, useTransition } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { useQuery } from "convex/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { api } from "@/convex/_generated/api";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

const statusOptions = [
  { label: "All statuses", value: "" },
  { label: "Pending", value: "pending" },
  { label: "Triaging", value: "triaging" },
  { label: "Awaiting approval", value: "awaiting_approval" },
  { label: "Reproducing", value: "reproducing" },
  { label: "Verifying", value: "verifying" },
  { label: "Completed", value: "completed" },
  { label: "Failed", value: "failed" },
  { label: "Cancelled", value: "cancelled" },
] as const;

const classificationOptions = [
  { label: "All classifications", value: "" },
  { label: "Bug", value: "bug" },
  { label: "Feature", value: "feature" },
  { label: "Docs", value: "docs" },
  { label: "Question", value: "question" },
  { label: "Build", value: "build" },
  { label: "Test", value: "test" },
] as const;

const controlClassName =
  "h-11 rounded-xl border border-border/80 bg-background/70 px-3 text-sm text-foreground outline-none transition focus:border-accent/40 focus:ring-2 focus:ring-ring/30";

function buildNextUrl(pathname: string, params: URLSearchParams) {
  const search = params.toString();

  return search.length > 0 ? `${pathname}?${search}` : pathname;
}

export function DashboardFilters() {
  const currentUser = useQuery(api.users.getCurrentUser, {});
  const repos = useQuery(api.dashboard.getRepoList, currentUser ? {} : "skip");
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isRouting, startTransition] = useTransition();

  const currentSearch = searchParams.get("q") ?? "";
  const repoId = searchParams.get("repoId") ?? "";
  const status = searchParams.get("status") ?? "";
  const classificationType = searchParams.get("classificationType") ?? "";
  const [searchDraft, setSearchDraft] = useState(currentSearch);

  useEffect(() => {
    setSearchDraft(currentSearch);
  }, [currentSearch]);

  useEffect(() => {
    const trimmedSearch = searchDraft.trim();

    if (trimmedSearch === currentSearch) {
      return;
    }

    const timeout = window.setTimeout(() => {
      const nextParams = new URLSearchParams(searchParams.toString());

      if (trimmedSearch) {
        nextParams.set("q", trimmedSearch);
      } else {
        nextParams.delete("q");
      }

      startTransition(() => {
        router.replace(buildNextUrl(pathname, nextParams), { scroll: false });
      });
    }, 300);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [currentSearch, pathname, router, searchDraft, searchParams]);

  function updateParam(name: string, value: string) {
    const nextParams = new URLSearchParams(searchParams.toString());

    if (value) {
      nextParams.set(name, value);
    } else {
      nextParams.delete(name);
    }

    startTransition(() => {
      router.replace(buildNextUrl(pathname, nextParams), { scroll: false });
    });
  }

  const repoOptions = [...(repos ?? [])].sort((left, right) =>
    left.fullName.localeCompare(right.fullName),
  );
  const controlsDisabled = currentUser === null || (currentUser && repos === undefined);

  return (
    <Panel className="gap-5 bg-panel/75 p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="section-label">
            <SlidersHorizontal className="h-4 w-4 text-accent" />
            Filter queue
          </div>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground">
            Narrow the live feed by repository, run status, classification, or
            issue title without leaving the dashboard.
          </p>
        </div>
        {isRouting ? (
          <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Updating
          </span>
        ) : null}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,0.6fr))]">
        <label className="space-y-2">
          <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Search title
          </span>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              className={cn(controlClassName, "pl-9")}
              disabled={controlsDisabled}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="Search issue titles"
              type="search"
              value={searchDraft}
            />
          </div>
        </label>

        <label className="space-y-2">
          <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Repository
          </span>
          <select
            className={controlClassName}
            disabled={controlsDisabled}
            onChange={(event) => updateParam("repoId", event.target.value)}
            value={repoId}
          >
            <option value="">All repositories</option>
            {repoOptions.map((repo) => (
              <option key={repo._id} value={repo._id}>
                {repo.fullName}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-2">
          <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Status
          </span>
          <select
            className={controlClassName}
            disabled={controlsDisabled}
            onChange={(event) => updateParam("status", event.target.value)}
            value={status}
          >
            {statusOptions.map((option) => (
              <option key={option.label} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-2">
          <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Classification
          </span>
          <select
            className={controlClassName}
            disabled={controlsDisabled}
            onChange={(event) =>
              updateParam("classificationType", event.target.value)
            }
            value={classificationType}
          >
            {classificationOptions.map((option) => (
              <option key={option.label} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </Panel>
  );
}
