import type { Doc } from "@/convex/_generated/dataModel";

const timestampFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

const runStatusLabels = {
  awaiting_approval: "Awaiting approval",
  approved: "Approved",
  cancelled: "Cancelled",
  completed: "Completed",
  failed: "Failed",
  needs_info: "Needs info",
  pending: "Pending",
  rejected: "Rejected",
  report_failed: "Report failed",
  reporting: "Reporting",
  reproducing: "Reproducing",
  triaging: "Triaging",
  verifying: "Verifying",
} satisfies Record<Doc<"runs">["status"], string>;

const approvalDecisionLabels = {
  approved: "Approved",
  rejected: "Rejected",
  request_info: "Needs info",
} satisfies Record<
  NonNullable<Doc<"runs">["approvalDecision"]>,
  string
>;

function formatDurationParts(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);

  if (totalMinutes < 60) {
    const seconds = totalSeconds % 60;

    return seconds > 0 ? `${totalMinutes}m ${seconds}s` : `${totalMinutes}m`;
  }

  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (totalHours < 24) {
    return minutes > 0 ? `${totalHours}h ${minutes}m` : `${totalHours}h`;
  }

  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;

  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}

export function timeAgo(timestamp: number): string {
  return `${formatDurationParts(Date.now() - timestamp)} ago`;
}

export function formatTimestamp(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "Unavailable";
  }

  const date = typeof value === "string" ? new Date(value) : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unavailable";
  }

  return `${timestampFormatter.format(date)} UTC`;
}

export function formatElapsed(startedAt: number, completedAt?: number | null) {
  return formatDurationParts((completedAt ?? Date.now()) - startedAt);
}

export function formatRunStatus(status: Doc<"runs">["status"]) {
  return runStatusLabels[status];
}

export function formatApprovalDecision(
  decision: Doc<"runs">["approvalDecision"] | null | undefined,
) {
  if (!decision) {
    return null;
  }

  return approvalDecisionLabels[decision];
}

export function classificationColor(type: string | null | undefined): string {
  const colors: Record<string, string> = {
    bug: "border-rose-400/20 bg-rose-400/10 text-rose-100",
    build: "border-orange-400/20 bg-orange-400/10 text-orange-100",
    docs: "border-sky-400/20 bg-sky-400/10 text-sky-100",
    feature: "border-cyan-400/20 bg-cyan-400/10 text-cyan-100",
    question: "border-violet-400/20 bg-violet-400/10 text-violet-100",
    test: "border-teal-400/20 bg-teal-400/10 text-teal-100",
  };

  return colors[type ?? ""] ?? "border-border/80 bg-background/70 text-foreground";
}

export function severityColor(severity: string | null | undefined): string {
  const colors: Record<string, string> = {
    critical: "border-rose-400/20 bg-rose-400/10 text-rose-100",
    high: "border-orange-400/20 bg-orange-400/10 text-orange-100",
    low: "border-sky-400/20 bg-sky-400/10 text-sky-100",
    medium: "border-amber-300/20 bg-amber-300/10 text-amber-100",
  };

  return colors[severity ?? ""] ?? "border-border/80 bg-background/70 text-foreground";
}
