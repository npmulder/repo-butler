"use client";

import { CheckCircle2, RotateCcw, TriangleAlert } from "lucide-react";

import { Panel } from "@/components/ui/panel";
import { getIterationSummary, type RunDetailData } from "@/lib/run-detail";

export function IterationHistory({ detail }: { detail: RunDetailData }) {
  if (detail.reproRuns.length === 0) {
    return (
      <Panel className="gap-4 p-6">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-muted-foreground">
            Iterations
          </p>
          <h2 className="mt-2 text-xl font-semibold">Feedback loop</h2>
        </div>
        <p className="text-sm leading-7 text-muted-foreground">
          No reproduction iterations have been captured yet.
        </p>
      </Panel>
    );
  }

  return (
    <Panel className="gap-5 p-6">
      <div className="space-y-2">
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-muted-foreground">
          Iterations
        </p>
        <h2 className="text-xl font-semibold">Feedback loop history</h2>
        <p className="max-w-3xl text-sm leading-7 text-muted-foreground">
          Each stored reproduction attempt is summarized here using the persisted
          sandbox outputs, failure signals, and artifact revisions.
        </p>
      </div>

      <div className="space-y-4">
        {detail.reproRuns.map((reproRun, index) => {
          const previousRun = index > 0 ? detail.reproRuns[index - 1] : null;
          const summary = getIterationSummary(reproRun, detail, previousRun);

          return (
            <section
              key={reproRun._id}
              className="rounded-[22px] border border-border/80 bg-background/50 p-4"
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-border/80 bg-panel/80 px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                      Iteration {summary.iteration}/{summary.totalIterations}
                    </span>
                    <span className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                      {summary.isSuccessfulIteration ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                      ) : (
                        <TriangleAlert className="h-4 w-4 text-amber-200" />
                      )}
                      {summary.title}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Stored {reproRun.steps.length} sandbox step
                    {reproRun.steps.length === 1 ? "" : "s"} for this attempt.
                  </p>
                </div>

                <div className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-background/60 px-3 py-1 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  <RotateCcw className="h-3.5 w-3.5" />
                  {summary.isSuccessfulIteration ? "Succeeded" : "Retry"}
                </div>
              </div>

              <div className="mt-4 space-y-3 text-sm leading-7 text-muted-foreground">
                <p>
                  <span className="font-medium text-foreground">Feedback:</span>{" "}
                  {summary.feedback}
                </p>
                <p>
                  <span className="font-medium text-foreground">Action:</span>{" "}
                  {summary.action}
                </p>
                {summary.isSuccessfulIteration && detail.reproPlan?.artifact.path ? (
                  <p>
                    <span className="font-medium text-foreground">Test artifact:</span>{" "}
                    {detail.reproPlan.artifact.path}
                  </p>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
    </Panel>
  );
}
