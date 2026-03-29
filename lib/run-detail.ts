import type { Doc } from "@/convex/_generated/dataModel";
import { formatRunStatus } from "@/lib/formatting";

export type ReproRunDetail = Doc<"reproRuns"> & { logUrl: string | null };
export type VerificationDetail = Doc<"verifications"> & { logUrl: string | null };

export type RunDetailData = {
  run: Doc<"runs">;
  issue: Doc<"issues"> | null;
  repo: Doc<"repos">;
  repoSettings: Doc<"repoSettings"> | null;
  triage: Doc<"triageResults"> | null;
  reproContract: Doc<"reproContracts"> | null;
  reproPlan: Doc<"reproPlans"> | null;
  reproRuns: ReproRunDetail[];
  latestReproRun: ReproRunDetail | null;
  verification: VerificationDetail | null;
};

export type TimelineStageStatus = "completed" | "active" | "failed" | "pending";

export type TimelineStage = {
  key: string;
  label: string;
  status: TimelineStageStatus;
  timestamp: number | null;
  durationLabel: string | null;
  detail: string;
};

const negativeTerminalStatuses = new Set<Doc<"runs">["status"]>([
  "cancelled",
  "failed",
  "needs_info",
  "rejected",
]);

function formatDuration(milliseconds: number | null) {
  if (milliseconds === null) {
    return null;
  }

  if (milliseconds < 1_000) {
    return "<1s";
  }

  const seconds = milliseconds / 1_000;

  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }

  const wholeMinutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);

  if (wholeMinutes < 60) {
    return remainingSeconds > 0
      ? `${wholeMinutes}m ${remainingSeconds}s`
      : `${wholeMinutes}m`;
  }

  const wholeHours = Math.floor(wholeMinutes / 60);
  const remainingMinutes = wholeMinutes % 60;

  return remainingMinutes > 0
    ? `${wholeHours}h ${remainingMinutes}m`
    : `${wholeHours}h`;
}

export function toNumber(
  value: bigint | number | null | undefined,
): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  return typeof value === "bigint" ? Number(value) : value;
}

export function formatStepDuration(
  value: bigint | number | null | undefined,
): string {
  return formatDuration(toNumber(value)) ?? "Unavailable";
}

export function formatShaFingerprint(value: string | null | undefined) {
  if (!value) {
    return "Unavailable";
  }

  if (value.length <= 18) {
    return value;
  }

  return `${value.slice(0, 8)}…${value.slice(-8)}`;
}

export function stringifyArtifact(value: unknown) {
  return JSON.stringify(
    value,
    (_key, currentValue) =>
      typeof currentValue === "bigint" ? currentValue.toString() : currentValue,
    2,
  );
}

export function normalizeBackHref(value: string | null | undefined) {
  if (!value) {
    return "/dashboard";
  }

  return value.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

export function getLatestFailedStep(reproRun: ReproRunDetail) {
  return [...reproRun.steps].reverse().find((step) => toNumber(step.exitCode) !== 0);
}

export function getIterationSummary(
  reproRun: ReproRunDetail,
  detail: RunDetailData,
  previousRun: ReproRunDetail | null,
) {
  const failedStep = getLatestFailedStep(reproRun);
  const iteration = toNumber(reproRun.iteration) ?? 0;
  const totalIterations = detail.reproRuns.length;
  const isSuccessfulIteration =
    detail.run.verdict === "reproduced" &&
    detail.latestReproRun?._id === reproRun._id;
  const feedback =
    failedStep?.stderrTail ||
    failedStep?.stdoutTail ||
    reproRun.failureObserved?.matchAny?.join(", ") ||
    reproRun.failureObserved?.kind ||
    (isSuccessfulIteration ? "Expected failure signal matched." : "No feedback stored.");
  let action = "No iteration action details were persisted.";

  if (reproRun.artifactContent) {
    if (!previousRun?.artifactContent) {
      action = "Generated the first candidate reproduction artifact.";
    } else if (previousRun.artifactContent !== reproRun.artifactContent) {
      action = "Updated the candidate reproduction artifact for the next attempt.";
    } else {
      action = "Re-ran the same artifact to validate the current approach.";
    }
  } else if (detail.reproPlan?.artifact.path) {
    action = `Attempted artifact at ${detail.reproPlan.artifact.path}.`;
  }

  let title = failedStep
    ? `Step '${failedStep.name}' failed`
    : "Attempt recorded";

  if (reproRun.failureType === "env_setup") {
    title = "Environment setup failed";
  } else if (isSuccessfulIteration) {
    title = "Reproduction confirmed";
  } else if (reproRun.failureObserved?.kind) {
    title = `Observed ${reproRun.failureObserved.kind.replaceAll("_", " ")}`;
  }

  return {
    action,
    feedback,
    isSuccessfulIteration,
    iteration,
    title,
    totalIterations,
  };
}

export function buildRunTimelineStages(
  detail: RunDetailData,
  now = Date.now(),
): TimelineStage[] {
  const { latestReproRun, reproPlan, reproRuns, run, triage, verification } = detail;
  const triageCompletedAt = triage?.createdAt ?? null;
  const approvalDecisionAt = run.approvalUpdatedAt ?? run.approvedAt ?? null;
  const reproductionStartedAt =
    reproRuns[0]?._creationTime ?? reproPlan?.createdAt ?? approvalDecisionAt;
  const verificationStartedAt =
    verification?.createdAt ??
    (run.status === "verifying" ? latestReproRun?._creationTime ?? null : null);
  const reportAt = run.completedAt ?? null;
  const isNegativeTerminal = negativeTerminalStatuses.has(run.status);
  const verificationFailed =
    verification !== null && verification.verdict !== "reproduced";
  const reproductionFailed =
    run.status === "failed" && verification === null;

  return [
    {
      key: "webhook",
      label: "Webhook",
      status: "completed",
      timestamp: run.startedAt,
      durationLabel: formatDuration(
        (triageCompletedAt ?? approvalDecisionAt ?? reproductionStartedAt ?? reportAt ?? now) -
          run.startedAt,
      ),
      detail: "Run accepted into the pipeline.",
    },
    {
      key: "triage",
      label: "Triage",
      status:
        triage !== null
          ? "completed"
          : run.status === "pending" || run.status === "triaging"
            ? "active"
            : "failed",
      timestamp:
        triageCompletedAt ??
        (run.status === "pending" || run.status === "triaging" ? run.startedAt : null),
      durationLabel: formatDuration(
        triage !== null
          ? triage.createdAt - run.startedAt
          : run.status === "pending" || run.status === "triaging"
            ? now - run.startedAt
            : null,
      ),
      detail:
        triage !== null
          ? "Structured triage output stored."
          : run.status === "pending" || run.status === "triaging"
            ? "Issue classification is running."
            : "Run ended before triage completed.",
    },
    {
      key: "approval",
      label: "Approval",
      status:
        run.status === "awaiting_approval"
          ? "active"
          : run.status === "rejected" || run.status === "needs_info"
            ? "failed"
            : approvalDecisionAt !== null || run.status === "approved" || reproductionStartedAt !== null
              ? "completed"
              : triage !== null
                ? "pending"
                : "pending",
      timestamp:
        approvalDecisionAt ??
        (run.status === "awaiting_approval" ? triageCompletedAt ?? run.startedAt : null),
      durationLabel: formatDuration(
        approvalDecisionAt !== null
          ? approvalDecisionAt - (triageCompletedAt ?? run.startedAt)
          : run.status === "awaiting_approval"
            ? now - (triageCompletedAt ?? run.startedAt)
            : null,
      ),
      detail:
        run.status === "awaiting_approval"
          ? "Awaiting maintainer decision."
          : run.status === "rejected"
            ? "Reproduction was rejected."
            : run.status === "needs_info"
              ? "More maintainer context is required."
              : approvalDecisionAt !== null || run.status === "approved" || reproductionStartedAt !== null
                ? "Approval gate completed."
                : "Approval has not started yet.",
    },
    {
      key: "reproduction",
      label: "Reproduction",
      status:
        run.status === "reproducing"
          ? "active"
          : reproductionFailed
            ? "failed"
            : reproRuns.length > 0 || run.status === "completed" || run.status === "verifying"
              ? "completed"
              : "pending",
      timestamp:
        reproductionStartedAt ??
        (run.status === "reproducing" ? approvalDecisionAt ?? triageCompletedAt : null),
      durationLabel: formatDuration(
        reproductionStartedAt !== null
          ? (
              (verificationStartedAt ??
                reportAt ??
                latestReproRun?._creationTime ??
                now) - reproductionStartedAt
            )
          : null,
      ),
      detail:
        run.status === "reproducing"
          ? "Sandbox execution is in progress."
          : reproductionFailed
            ? "Reproduction finished in a failed state."
            : reproRuns.length > 0
              ? "Reproduction iterations are available."
              : "Sandbox work has not started yet.",
    },
    {
      key: "verification",
      label: "Verification",
      status:
        run.status === "verifying"
          ? "active"
          : verificationFailed
            ? "failed"
            : verification !== null
              ? "completed"
              : "pending",
      timestamp: verificationStartedAt,
      durationLabel: formatDuration(
        verificationStartedAt !== null
          ? (reportAt ?? now) - verificationStartedAt
          : null,
      ),
      detail:
        run.status === "verifying"
          ? "Verification is running."
          : verificationFailed
            ? "Verification recorded a non-reproduced verdict."
            : verification !== null
              ? "Verification completed."
              : "Verification has not started yet.",
    },
    {
      key: "report",
      label: "Report",
      status:
        reportAt !== null
          ? isNegativeTerminal || verificationFailed
            ? "failed"
            : "completed"
          : run.status === "verifying"
            ? "active"
            : "pending",
      timestamp: reportAt,
      durationLabel: null,
      detail:
        reportAt !== null
          ? `Run finished as ${formatRunStatus(run.status).toLowerCase()}.`
          : run.status === "verifying"
            ? "Preparing the final result."
            : "Final result has not been recorded yet.",
    },
  ];
}
