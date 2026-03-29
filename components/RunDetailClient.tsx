"use client";

import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { useQuery } from "convex/react";
import { useSearchParams } from "next/navigation";

import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { ArtifactViewer } from "@/components/ArtifactViewer";
import { IterationHistory } from "@/components/IterationHistory";
import { RunTimeline } from "@/components/RunTimeline";
import { SandboxInfo } from "@/components/SandboxInfo";
import { StatusBadge } from "@/components/StatusBadge";
import { StepLogViewer } from "@/components/StepLogViewer";
import { buttonStyles } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { formatTimestamp } from "@/lib/formatting";
import {
  normalizeBackHref,
  type RunDetailData,
} from "@/lib/run-detail";

export function RunDetailClient({ runId }: { runId: string }) {
  const searchParams = useSearchParams();
  const detail = useQuery(api.runDetail.getFullRunDetail, {
    runId: runId as Id<"runs">,
  }) as RunDetailData | null | undefined;
  const backHref = normalizeBackHref(searchParams.get("back"));

  if (detail === undefined) {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="space-y-3">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-muted-foreground">
            Run detail
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Loading pipeline data
          </h1>
          <p className="max-w-3xl text-sm leading-7 text-muted-foreground">
            Subscribing to the latest run, artifact, and sandbox state.
          </p>
        </div>

        <Panel className="gap-4 p-6">
          <p className="text-sm leading-7 text-muted-foreground">
            Waiting for the run detail subscription to hydrate.
          </p>
        </Panel>
      </div>
    );
  }

  if (detail === null) {
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <div className="space-y-3">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-muted-foreground">
            Run detail
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Run unavailable
          </h1>
          <p className="max-w-3xl text-sm leading-7 text-muted-foreground">
            This run could not be found or is not accessible to the current
            workspace.
          </p>
        </div>

        <Panel className="gap-4 p-6">
          <Link className={buttonStyles({ className: "self-start" })} href={backHref}>
            <ArrowLeft className="h-4 w-4" />
            Return to dashboard
          </Link>
        </Panel>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Link href="/dashboard" className="hover:text-accent">
            Dashboard
          </Link>
          <span>/</span>
          <Link href="/dashboard/runs" className="hover:text-accent">
            Runs
          </Link>
          <span>/</span>
          <span className="text-foreground">Run {detail.run.runId}</span>
        </div>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-mono text-xs uppercase tracking-[0.24em] text-muted-foreground">
                Run detail
              </p>
              <StatusBadge status={detail.run.status} />
              {detail.run.verdict ? (
                <span className="rounded-full border border-border/80 bg-background/70 px-3 py-1 text-xs font-medium text-foreground">
                  {detail.run.verdict.replaceAll("_", " ")}
                </span>
              ) : null}
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">
              {detail.issue?.title ?? detail.run.runId}
            </h1>
            <p className="max-w-3xl text-sm leading-7 text-muted-foreground">
              {detail.repo.fullName} · started {formatTimestamp(detail.run.startedAt)}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link className={buttonStyles({ variant: "ghost" })} href={backHref}>
              <ArrowLeft className="h-4 w-4" />
              Back
            </Link>
            {detail.issue?.githubIssueUrl ? (
              <a
                className={buttonStyles()}
                href={detail.issue.githubIssueUrl}
                rel="noreferrer"
                target="_blank"
              >
                Source issue
                <ArrowUpRight className="h-4 w-4" />
              </a>
            ) : null}
          </div>
        </div>
      </div>

      <RunTimeline detail={detail} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.9fr)]">
        <StepLogViewer reproRuns={detail.reproRuns} />
        <div className="space-y-6">
          <SandboxInfo detail={detail} />
          <IterationHistory detail={detail} />
        </div>
      </div>

      <ArtifactViewer detail={detail} />
    </div>
  );
}
