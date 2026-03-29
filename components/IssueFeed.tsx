"use client";

import type { Doc, Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { Panel } from "@/components/ui/panel";
import { TriageCard } from "@/components/TriageCard";
import { useQuery } from "convex/react";
import { Activity, Inbox, LoaderCircle } from "lucide-react";
import { useSearchParams } from "next/navigation";

type RunStatus = Doc<"runs">["status"];
type ClassificationType = NonNullable<Doc<"triageResults">["classificationType"]>;

const runStatuses = new Set<RunStatus>([
  "pending",
  "triaging",
  "awaiting_approval",
  "reproducing",
  "verifying",
  "completed",
  "failed",
  "cancelled",
]);

const classificationTypes = new Set<ClassificationType>([
  "bug",
  "docs",
  "question",
  "feature",
  "build",
  "test",
]);

function parseRunStatus(value: string | null) {
  return value && runStatuses.has(value as RunStatus)
    ? (value as RunStatus)
    : undefined;
}

function parseClassificationType(value: string | null) {
  return value && classificationTypes.has(value as ClassificationType)
    ? (value as ClassificationType)
    : undefined;
}

function StatCard({
  label,
  tone,
  value,
}: {
  label: string;
  tone?: "accent" | "danger" | "success" | "warning";
  value: number;
}) {
  const toneClass = tone
    ? {
        accent: "text-accent",
        danger: "text-rose-200",
        success: "text-emerald-200",
        warning: "text-amber-100",
      }[tone]
    : "text-foreground";

  return (
    <Panel className="gap-2 bg-panel/75 p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`font-mono text-3xl font-semibold ${toneClass}`}>{value}</p>
    </Panel>
  );
}

export function IssueFeed() {
  const currentUser = useQuery(api.users.getCurrentUser, {});
  const searchParams = useSearchParams();
  const repoId = searchParams.get("repoId");
  const status = parseRunStatus(searchParams.get("status"));
  const classificationType = parseClassificationType(
    searchParams.get("classificationType"),
  );
  const searchTerm = (searchParams.get("q") ?? "").trim().toLowerCase();

  const feed = useQuery(
    api.dashboard.getIssueFeed,
    currentUser
      ? {
          classificationType,
          limit: 80,
          repoId: (repoId as Id<"repos"> | null) ?? undefined,
          status,
        }
      : "skip",
  );
  const stats = useQuery(
    api.dashboard.getDashboardStats,
    currentUser
      ? { repoId: (repoId as Id<"repos"> | null) ?? undefined }
      : "skip",
  );

  if (currentUser === undefined || (currentUser && feed === undefined)) {
    return (
      <Panel className="gap-4 p-6">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin text-accent" />
          Subscribing to the latest triage runs and issue snapshots.
        </div>
      </Panel>
    );
  }

  if (currentUser === null) {
    return (
      <Panel className="gap-4 p-6">
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-muted-foreground">
          Convex profile pending
        </p>
        <h2 className="text-2xl font-semibold tracking-tight">
          The dashboard is waiting for your Convex user record.
        </h2>
        <p className="max-w-3xl text-sm leading-7 text-muted-foreground">
          WorkOS authentication is active, but the matching Convex `users`
          document has not been synced yet. Once that record exists, the live
          issue feed will subscribe automatically.
        </p>
      </Panel>
    );
  }

  const filteredFeed = (feed ?? []).filter((item) => {
    if (!searchTerm) {
      return true;
    }

    return item.issue?.title.toLowerCase().includes(searchTerm) ?? false;
  });

  return (
    <div className="space-y-6">
      {stats ? (
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatCard label="Last 24h" value={stats.total24h} />
          <StatCard label="Triaged" tone="success" value={stats.triaged} />
          <StatCard
            label="Awaiting approval"
            tone="warning"
            value={stats.awaitingApproval}
          />
          <StatCard
            label="In sandbox"
            tone="accent"
            value={stats.activeSandbox}
          />
          <StatCard label="Completed" tone="success" value={stats.completed} />
          <StatCard label="Failed" tone="danger" value={stats.failed} />
        </div>
      ) : null}

      {filteredFeed.length === 0 ? (
        <Panel className="gap-4 p-6">
          <div className="flex items-start gap-3">
            <Inbox className="mt-0.5 h-5 w-5 text-accent" />
            <div>
              <h2 className="text-lg font-medium">No issues match the current filters</h2>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-muted-foreground">
                Adjust the repository, status, classification, or title search
                filters to broaden the feed. New runs will appear here in real
                time as Convex updates arrive.
              </p>
            </div>
          </div>
        </Panel>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">Incoming issue feed</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                The newest triage decisions stay live while approvals and run
                status changes stream from Convex.
              </p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-accent">
              <Activity className="h-3.5 w-3.5" />
              Live updates
            </span>
          </div>

          {filteredFeed.map((item) => (
            <TriageCard
              key={item.run._id}
              issue={item.issue}
              repo={item.repo}
              run={item.run}
              triage={item.triage}
            />
          ))}
        </div>
      )}
    </div>
  );
}
