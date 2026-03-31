"use client";

import { Activity, CircleCheckBig, Clock3, TriangleAlert } from "lucide-react";
import { useQuery } from "convex/react";
import Link from "next/link";

import { Panel } from "@/components/ui/panel";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";

type RunStatus = Doc<"runs">["status"];
type RunTrigger = Doc<"runs">["triggeredBy"];

const statusStyles = {
  pending: "border-white/10 bg-white/5 text-slate-100",
  triaging: "border-sky-400/20 bg-sky-400/10 text-sky-100",
  awaiting_approval: "border-amber-300/20 bg-amber-300/10 text-amber-100",
  approved: "border-emerald-400/20 bg-emerald-400/10 text-emerald-100",
  rejected: "border-rose-400/20 bg-rose-400/10 text-rose-100",
  needs_info: "border-amber-300/20 bg-amber-300/10 text-amber-100",
  reproducing: "border-fuchsia-400/20 bg-fuchsia-400/10 text-fuchsia-100",
  verifying: "border-cyan-300/20 bg-cyan-300/10 text-cyan-100",
  completed: "border-emerald-400/20 bg-emerald-400/10 text-emerald-100",
  failed: "border-rose-400/20 bg-rose-400/10 text-rose-100",
  cancelled: "border-slate-400/20 bg-slate-400/10 text-slate-200",
} satisfies Record<RunStatus, string>;

const triggerLabels = {
  issue_opened: "Issue opened",
  label_added: "Label added",
  comment_command: "Comment command",
  manual: "Manual",
} satisfies Record<RunTrigger, string>;

const activeStatuses: readonly RunStatus[] = [
  "pending",
  "triaging",
  "awaiting_approval",
  "approved",
  "reproducing",
  "verifying",
] as const;

const failedStatuses: readonly RunStatus[] = [
  "failed",
  "cancelled",
  "rejected",
] as const;

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function formatStatus(status: RunStatus) {
  return status.replaceAll("_", " ");
}

function formatTimestamp(timestamp: number) {
  return `${dateFormatter.format(new Date(timestamp))} UTC`;
}

export default function RunsPage() {
  const runs = useQuery(api.runs.listRecent, {}) as Doc<"runs">[] | undefined;

  if (runs === undefined) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Runs</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Loading the latest pipeline activity from Convex.
          </p>
        </div>
        <Panel className="gap-3 p-5">
          <p className="text-sm text-muted-foreground">
            Subscribing to recent triage, reproduction, and verification runs.
          </p>
        </Panel>
      </div>
    );
  }

  const activeRuns = runs.filter((run) => activeStatuses.includes(run.status)).length;
  const reproducedRuns = runs.filter(
    (run) => run.status === "completed" && run.verdict === "reproduced",
  ).length;
  const failedRuns = runs.filter((run) => failedStatuses.includes(run.status)).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Runs</h1>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
            Live Convex subscription for the latest pipeline runs, including triage status,
            reproduction progress, and final verification verdicts.
          </p>
        </div>
        <span className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-accent">
          Live updates
        </span>
      </div>

      <section className="grid gap-4 lg:grid-cols-3">
        <Panel className="gap-4 p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Tracked runs</span>
            <Clock3 className="h-4 w-4 text-accent" />
          </div>
          <p className="font-mono text-3xl font-semibold">{runs.length}</p>
          <p className="text-sm leading-7 text-muted-foreground">
            The 25 most recent runs for your connected repositories.
          </p>
        </Panel>

        <Panel className="gap-4 p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Active runs</span>
            <Activity className="h-4 w-4 text-accent" />
          </div>
          <p className="font-mono text-3xl font-semibold">{activeRuns}</p>
          <p className="text-sm leading-7 text-muted-foreground">
            Pending, triaging, approved, awaiting approval, reproducing, or verifying right now.
          </p>
        </Panel>

        <Panel className="gap-4 p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Terminal outcomes</span>
            <CircleCheckBig className="h-4 w-4 text-accent" />
          </div>
          <p className="font-mono text-3xl font-semibold">
            {reproducedRuns}
            <span className="mx-2 text-muted-foreground/60">/</span>
            {failedRuns}
          </p>
          <p className="text-sm leading-7 text-muted-foreground">
            Reproduced runs versus failed, rejected, or cancelled runs in the current window.
          </p>
        </Panel>
      </section>

      {runs.length === 0 ? (
        <Panel className="gap-4 p-6">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 h-4 w-4 text-accent" />
            <div>
              <h2 className="text-lg font-medium">No runs yet</h2>
              <p className="mt-2 text-sm leading-7 text-muted-foreground">
                Once an issue is queued into the pipeline, its triage, reproduction, and
                verification state will stream here automatically.
              </p>
            </div>
          </div>
        </Panel>
      ) : (
        <Panel className="overflow-hidden">
          <div className="border-b border-border/80 px-5 py-4">
            <h2 className="text-lg font-medium">Recent run history</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Status and verdict changes appear here without a page refresh.
            </p>
          </div>
          <div className="divide-y divide-border/80">
            {runs.map((run) => (
              <Link
                key={run._id}
                href={`/runs/${run._id}?back=%2Fdashboard%2Fruns`}
                className="grid gap-4 px-5 py-4 transition hover:bg-background/40 lg:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="truncate font-mono text-sm text-foreground">{run.runId}</p>
                    <span className="rounded-full border border-border/80 bg-background/70 px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                      {triggerLabels[run.triggeredBy]}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                    <span>Started {formatTimestamp(run.startedAt)}</span>
                    <span>
                      {run.completedAt ? `Completed ${formatTimestamp(run.completedAt)}` : "Still in progress"}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-start gap-2 lg:justify-end">
                  {run.verdict ? (
                    <span className="rounded-full border border-border/80 bg-background/70 px-3 py-1 text-xs font-medium text-foreground">
                      {run.verdict.replaceAll("_", " ")}
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium capitalize",
                      statusStyles[run.status],
                    )}
                  >
                    {formatStatus(run.status)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
