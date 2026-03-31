"use client";

import {
  Circle,
  CircleCheckBig,
  CircleX,
  LoaderCircle,
} from "lucide-react";

import { Panel } from "@/components/ui/panel";
import { formatTimestamp, timeAgo } from "@/lib/formatting";
import {
  buildRunTimelineStages,
  type RunDetailData,
  type TimelineStageStatus,
} from "@/lib/run-detail";
import { cn } from "@/lib/utils";

const stageTone = {
  active: "border-accent/30 bg-accent/10 text-accent",
  completed: "border-emerald-400/20 bg-emerald-400/10 text-emerald-100",
  failed: "border-rose-400/20 bg-rose-400/10 text-rose-100",
  pending: "border-border/80 bg-background/55 text-muted-foreground",
} satisfies Record<TimelineStageStatus, string>;

function StageIcon({ status }: { status: TimelineStageStatus }) {
  if (status === "completed") {
    return <CircleCheckBig className="h-4 w-4" />;
  }

  if (status === "active") {
    return <LoaderCircle className="h-4 w-4 animate-spin" />;
  }

  if (status === "failed") {
    return <CircleX className="h-4 w-4" />;
  }

  return <Circle className="h-4 w-4" />;
}

export function RunTimeline({
  detail,
  now,
}: {
  detail: RunDetailData;
  now?: number;
}) {
  const stages = buildRunTimelineStages(detail, now);

  return (
    <Panel className="gap-5 p-6">
      <div className="space-y-2">
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-muted-foreground">
          Pipeline timeline
        </p>
        <h2 className="text-xl font-semibold">Run progression</h2>
        <p className="max-w-3xl text-sm leading-7 text-muted-foreground">
          Convex subscriptions keep this timeline live while triage,
          reproduction, and verification data stream into the run.
        </p>
      </div>

      <ol className="grid gap-4 xl:grid-cols-6">
        {stages.map((stage, index) => (
          <li
            key={stage.key}
            className="relative rounded-[22px] border border-border/80 bg-background/50 p-4"
          >
            {index < stages.length - 1 ? (
              <div
                aria-hidden="true"
                className="absolute left-5 top-11 h-[calc(100%-2rem)] w-px bg-border/70 xl:left-[calc(100%+0.5rem)] xl:top-5 xl:h-px xl:w-4"
              />
            ) : null}

            <div className="flex items-start gap-3">
              <div
                className={cn(
                  "mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-full border",
                  stageTone[stage.status],
                  stage.status === "active" && "animate-pulse",
                )}
              >
                <StageIcon status={stage.status} />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-foreground">{stage.label}</p>
                  <span
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.18em]",
                      stageTone[stage.status],
                    )}
                  >
                    {stage.status}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {stage.detail}
                </p>
                <dl className="mt-4 space-y-2 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-muted-foreground">Timestamp</dt>
                    <dd className="text-right text-foreground/90">
                      {stage.timestamp ? formatTimestamp(stage.timestamp) : "Pending"}
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-muted-foreground">Relative</dt>
                    <dd className="text-right text-foreground/90">
                      {stage.timestamp ? timeAgo(stage.timestamp) : "Pending"}
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-muted-foreground">Duration</dt>
                    <dd className="text-right text-foreground/90">
                      {stage.durationLabel ?? "Pending"}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
