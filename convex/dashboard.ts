import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { requireCurrentUser, requireRepoAccess } from "./lib/auth";

const runStatusValidator = v.union(
  v.literal("pending"),
  v.literal("triaging"),
  v.literal("awaiting_approval"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("needs_info"),
  v.literal("reproducing"),
  v.literal("verifying"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
);

const classificationTypeValidator = v.union(
  v.literal("bug"),
  v.literal("docs"),
  v.literal("question"),
  v.literal("feature"),
  v.literal("build"),
  v.literal("test"),
);

type DashboardFeedItem = {
  issue: Doc<"issues"> | null;
  repo: { fullName: string; name: string; owner: string } | null;
  run: Doc<"runs">;
  triage: Doc<"triageResults"> | null;
};

type DashboardStats = {
  activeSandbox: number;
  awaitingApproval: number;
  completed: number;
  failed: number;
  total24h: number;
  triaged: number;
};

const MAX_FEED_LIMIT = 100;
const MAX_STATS_SCAN = 500;

function normalizeFeedLimit(limit: number | undefined) {
  return Math.min(Math.max(limit ?? 50, 1), MAX_FEED_LIMIT);
}

async function loadIssuesById(ctx: QueryCtx, issueIds: Id<"issues">[]) {
  const issues = await Promise.all(issueIds.map((issueId) => ctx.db.get(issueId)));

  return new Map(issueIds.map((issueId, index) => [issueId, issues[index] ?? null]));
}

async function loadReposById(ctx: QueryCtx, repoIds: Id<"repos">[]) {
  const repos = await Promise.all(repoIds.map((repoId) => ctx.db.get(repoId)));

  return new Map(
    repoIds.map((repoId, index) => {
      const repo = repos[index];

      return [
        repoId,
        repo
          ? {
              fullName: repo.fullName,
              name: repo.name,
              owner: repo.owner,
            }
          : null,
      ];
    }),
  );
}

async function listRunsForFeed(ctx: QueryCtx, repoId: Id<"repos"> | undefined, limit: number) {
  if (repoId) {
    await requireRepoAccess(ctx, repoId);

    return await ctx.db
      .query("runs")
      .withIndex("by_repo", (query) => query.eq("repoId", repoId))
      .order("desc")
      .take(limit);
  }

  const user = await requireCurrentUser(ctx);

  return await ctx.db
    .query("runs")
    .withIndex("by_user_and_started_at", (query) => query.eq("userId", user._id))
    .order("desc")
    .take(limit);
}

async function listRunsForStats(ctx: QueryCtx, repoId: Id<"repos"> | undefined) {
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recentRuns: Doc<"runs">[] = [];

  if (repoId) {
    await requireRepoAccess(ctx, repoId);

    for await (const run of ctx.db
      .query("runs")
      .withIndex("by_repo", (query) => query.eq("repoId", repoId))
      .order("desc")) {
      if (run.startedAt < oneDayAgo || recentRuns.length >= MAX_STATS_SCAN) {
        break;
      }

      recentRuns.push(run);
    }

    return recentRuns;
  }

  const user = await requireCurrentUser(ctx);

  for await (const run of ctx.db
    .query("runs")
    .withIndex("by_user_and_started_at", (query) => query.eq("userId", user._id))
    .order("desc")) {
    if (run.startedAt < oneDayAgo || recentRuns.length >= MAX_STATS_SCAN) {
      break;
    }

    recentRuns.push(run);
  }

  return recentRuns;
}

export function filterDashboardFeed(
  items: DashboardFeedItem[],
  filters: {
    classificationType?: NonNullable<Doc<"triageResults">["classificationType"]>;
    status?: Doc<"runs">["status"];
  },
) {
  return items.filter((item) => {
    if (filters.status && item.run.status !== filters.status) {
      return false;
    }

    if (
      filters.classificationType &&
      item.triage?.classificationType !== filters.classificationType
    ) {
      return false;
    }

    return true;
  });
}

export function summarizeDashboardStats(
  runs: Array<Pick<Doc<"runs">, "status">>,
): DashboardStats {
  return runs.reduce<DashboardStats>(
    (stats, run) => {
      stats.total24h += 1;

      if (run.status !== "pending" && run.status !== "triaging") {
        stats.triaged += 1;
      }

      if (run.status === "awaiting_approval") {
        stats.awaitingApproval += 1;
      }

      if (run.status === "reproducing" || run.status === "verifying") {
        stats.activeSandbox += 1;
      }

      if (run.status === "completed") {
        stats.completed += 1;
      }

      if (run.status === "failed" || run.status === "cancelled") {
        stats.failed += 1;
      }

      return stats;
    },
    {
      activeSandbox: 0,
      awaitingApproval: 0,
      completed: 0,
      failed: 0,
      total24h: 0,
      triaged: 0,
    },
  );
}

export const getIssueFeed = query({
  args: {
    classificationType: v.optional(classificationTypeValidator),
    limit: v.optional(v.number()),
    repoId: v.optional(v.id("repos")),
    status: v.optional(runStatusValidator),
  },
  handler: async (ctx, args) => {
    const runs = await listRunsForFeed(
      ctx,
      args.repoId,
      normalizeFeedLimit(args.limit),
    );
    const issueIds = [...new Set(runs.map((run) => run.issueId))];
    const repoIds = [...new Set(runs.map((run) => run.repoId))];
    const [issuesById, reposById] = await Promise.all([
      loadIssuesById(ctx, issueIds),
      loadReposById(ctx, repoIds),
    ]);

    const feed = await Promise.all(
      runs.map(async (run) => {
        const triage = await ctx.db
          .query("triageResults")
          .withIndex("by_run", (query) => query.eq("runId", run._id))
          .unique();

        return {
          issue: issuesById.get(run.issueId) ?? null,
          repo: reposById.get(run.repoId) ?? null,
          run,
          triage,
        };
      }),
    );

    return filterDashboardFeed(feed, {
      classificationType: args.classificationType,
      status: args.status,
    });
  },
});

export const getDashboardStats = query({
  args: {
    repoId: v.optional(v.id("repos")),
  },
  handler: async (ctx, args) => {
    const recentRuns = await listRunsForStats(ctx, args.repoId);

    return summarizeDashboardStats(recentRuns);
  },
});

export const getRepoList = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    const repos = await ctx.db
      .query("repos")
      .withIndex("by_user", (query) => query.eq("userId", user._id))
      .take(100);

    return repos
      .filter((repo) => repo.isActive)
      .sort((left, right) => left.fullName.localeCompare(right.fullName));
  },
});
