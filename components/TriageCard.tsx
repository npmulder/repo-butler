"use client";

import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Clock3,
  Milestone,
  TriangleAlert,
} from "lucide-react";
import { useSearchParams } from "next/navigation";

import type { Doc } from "@/convex/_generated/dataModel";
import { ApprovalActions } from "@/components/ApprovalActions";
import { ConfidenceMeter } from "@/components/ConfidenceMeter";
import { StatusBadge } from "@/components/StatusBadge";
import { buttonStyles } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import {
  classificationColor,
  formatApprovalDecision,
  formatElapsed,
  formatTimestamp,
  severityColor,
  timeAgo,
} from "@/lib/formatting";
import { getIssueSnapshottedAt } from "@/lib/issueSnapshot";
import { cn } from "@/lib/utils";

type TriageCardProps = {
  issue: Doc<"issues"> | null;
  repo: { fullName: string; name: string; owner: string } | null;
  run: Doc<"runs">;
  triage: Doc<"triageResults"> | null;
};

export function TriageCard({ issue, repo, run, triage }: TriageCardProps) {
  const [showHypothesis, setShowHypothesis] = useState(false);
  const searchParams = useSearchParams();
  const classificationType =
    triage?.classificationType ?? triage?.classification?.type ?? null;
  const severity = triage?.severity ?? triage?.classification?.severity ?? null;
  const confidence = triage?.confidence ?? triage?.classification?.confidence;
  const areaTags = triage?.classification?.area ?? [];
  const approvalDecisionLabel = formatApprovalDecision(run.approvalDecision);
  const minimalSteps = triage?.reproHypothesis?.minimalStepsGuess ?? [];
  const expectedFailureSignal = triage?.reproHypothesis?.expectedFailureSignal;
  const environmentAssumptions = triage?.reproHypothesis?.environmentAssumptions;
  const issueNumber = issue ? `#${issue.githubIssueNumber.toString()}` : null;
  const backQuery = searchParams.toString();
  const runDetailHref = `/runs/${run._id}${backQuery ? `?back=${encodeURIComponent(`/dashboard?${backQuery}`)}` : "?back=%2Fdashboard"}` as Route;

  return (
    <Panel className="overflow-hidden bg-panel/75">
      <div className="flex flex-col gap-4 border-b border-border/80 px-5 py-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xl font-semibold text-foreground">
              {issue?.title ?? "Issue snapshot unavailable"}
            </h3>
            {issueNumber ? (
              <span className="rounded-full border border-border/80 bg-background/70 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                {issueNumber}
              </span>
            ) : null}
            <StatusBadge status={run.status} />
            {approvalDecisionLabel ? (
              <span className="rounded-full border border-border/80 bg-background/70 px-3 py-1 text-xs font-medium text-foreground">
                {approvalDecisionLabel}
              </span>
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
            <span>{repo?.fullName ?? "Repository unavailable"}</span>
            <span>Run started {timeAgo(run.startedAt)}</span>
            <span>Elapsed {formatElapsed(run.startedAt, run.completedAt)}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            className={buttonStyles({ variant: "ghost" })}
            href={runDetailHref}
          >
            Run details
          </Link>
          {issue?.githubIssueUrl ? (
            <a
              className="inline-flex items-center gap-2 rounded-xl border border-border/80 bg-background/60 px-3 py-2 text-sm font-medium text-foreground hover:border-accent/30 hover:text-accent"
              href={issue.githubIssueUrl}
              rel="noreferrer"
              target="_blank"
            >
              Open on GitHub
              <ArrowUpRight className="h-4 w-4" />
            </a>
          ) : null}
        </div>
      </div>

      <div className="grid gap-5 px-5 py-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {classificationType ? (
              <span
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium capitalize",
                  classificationColor(classificationType),
                )}
              >
                {classificationType}
              </span>
            ) : null}

            {severity ? (
              <span
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium capitalize",
                  severityColor(severity),
                )}
              >
                {severity}
              </span>
            ) : null}

            {areaTags.map((area) => (
              <span
                key={area}
                className="rounded-full border border-border/80 bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground"
              >
                {area}
              </span>
            ))}
          </div>

          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Triager summary
            </p>
            <p className="mt-3 text-sm leading-7 text-foreground/95">
              {triage?.summary ??
                "This run has not produced a persisted triage summary yet."}
            </p>
          </div>

          <button
            className="inline-flex items-center gap-2 text-sm font-medium text-accent hover:text-orange-300"
            onClick={() => setShowHypothesis((value) => !value)}
            type="button"
          >
            {showHypothesis ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
            {showHypothesis ? "Hide repro hypothesis" : "Show repro hypothesis"}
          </button>

          {showHypothesis ? (
            <div className="space-y-4 rounded-[22px] border border-border/80 bg-background/55 p-4">
              <div className="flex items-start gap-3">
                <Milestone className="mt-0.5 h-4 w-4 text-accent" />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Expected failure signal
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {expectedFailureSignal
                      ? expectedFailureSignal.kind.replaceAll("_", " ")
                      : "No failure signal was captured."}
                  </p>
                  {expectedFailureSignal?.matchAny?.length ? (
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      Match any: {expectedFailureSignal.matchAny.join(", ")}
                    </p>
                  ) : null}
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-foreground">
                  Minimal steps guess
                </p>
                {minimalSteps.length ? (
                  <ol className="mt-2 space-y-2 text-sm leading-6 text-muted-foreground">
                    {minimalSteps.map((step, index) => (
                      <li key={`${index + 1}-${step}`}>
                        {index + 1}. {step}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">
                    No step-by-step hypothesis was stored for this run.
                  </p>
                )}
              </div>

              {environmentAssumptions &&
              typeof environmentAssumptions === "object" &&
              Object.keys(environmentAssumptions).length > 0 ? (
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Environment assumptions
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {Object.entries(environmentAssumptions).map(([key, value]) => (
                      <span
                        key={key}
                        className="rounded-full border border-border/80 bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground"
                      >
                        {key}: {String(value)}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {run.status === "awaiting_approval" ? (
            <ApprovalActions runId={run._id} />
          ) : null}

          {run.errorMessage ? (
            <div className="flex items-start gap-3 rounded-[22px] border border-rose-400/20 bg-rose-400/10 p-4">
              <TriangleAlert className="mt-0.5 h-4 w-4 text-rose-200" />
              <p className="text-sm leading-6 text-rose-100">{run.errorMessage}</p>
            </div>
          ) : null}
        </div>

        <div className="space-y-4 rounded-[24px] border border-border/80 bg-background/55 p-4">
          <ConfidenceMeter confidence={confidence} />

          <div className="space-y-3 text-sm text-muted-foreground">
            <div className="flex items-start justify-between gap-3">
              <span className="inline-flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-accent" />
                Issue created
              </span>
              <span className="text-right text-foreground/90">
                {formatTimestamp(
                  issue
                    ? issue.githubCreatedAt ?? getIssueSnapshottedAt(issue)
                    : undefined,
                )}
              </span>
            </div>

            <div className="flex items-start justify-between gap-3">
              <span>Triaged</span>
              <span className="text-right text-foreground/90">
                {triage?.createdAt ? formatTimestamp(triage.createdAt) : "Pending"}
              </span>
            </div>

            <div className="flex items-start justify-between gap-3">
              <span>Run started</span>
              <span className="text-right text-foreground/90">
                {formatTimestamp(run.startedAt)}
              </span>
            </div>

            <div className="flex items-start justify-between gap-3">
              <span>Completed</span>
              <span className="text-right text-foreground/90">
                {run.completedAt ? formatTimestamp(run.completedAt) : "Still in progress"}
              </span>
            </div>

            {run.verdict ? (
              <div className="flex items-start justify-between gap-3">
                <span>Verdict</span>
                <span className="text-right capitalize text-foreground/90">
                  {run.verdict.replaceAll("_", " ")}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Panel>
  );
}
