import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { requireCurrentUser, requireRepoAccess } from "./lib/auth";

const triggeredByValidator = v.union(
  v.literal("issue_opened"),
  v.literal("label_added"),
  v.literal("comment_command"),
  v.literal("manual"),
);

const runStatusValidator = v.union(
  v.literal("pending"),
  v.literal("triaging"),
  v.literal("awaiting_approval"),
  v.literal("reproducing"),
  v.literal("verifying"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
);

const verdictValidator = v.union(
  v.literal("reproduced"),
  v.literal("not_reproduced"),
  v.literal("flaky"),
  v.literal("policy_violation"),
  v.literal("env_setup_failed"),
  v.literal("budget_exhausted"),
);

export const create = internalMutation({
  args: {
    issueId: v.id("issues"),
    repoId: v.id("repos"),
    triggeredBy: triggeredByValidator,
    triggeredByUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const issue = await ctx.db.get(args.issueId);
    if (!issue) {
      throw new Error("Issue not found");
    }

    const repo = await ctx.db.get(args.repoId);
    if (!repo) {
      throw new Error("Repo not found");
    }

    if (issue.repoId !== args.repoId) {
      throw new Error("Issue does not belong to the provided repo");
    }

    const now = Date.now();
    const runId = `${new Date(now).toISOString()}_${repo.fullName}_${issue.githubIssueNumber}`;

    return await ctx.db.insert("runs", {
      runId,
      userId: repo.userId,
      issueId: args.issueId,
      repoId: args.repoId,
      triggeredBy: args.triggeredBy,
      ...(args.triggeredByUserId
        ? { triggeredByUserId: args.triggeredByUserId }
        : {}),
      status: "pending",
      startedAt: now,
    });
  },
});

export const updateStatus = internalMutation({
  args: {
    runId: v.id("runs"),
    status: runStatusValidator,
    verdict: v.optional(verdictValidator),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);

    if (!run) {
      throw new Error("Run not found");
    }

    const patch: {
      status: typeof args.status;
      completedAt?: number;
      verdict?: typeof args.verdict;
      errorMessage?: string;
    } = { status: args.status };

    if (args.verdict) {
      patch.verdict = args.verdict;
    }

    if (args.errorMessage) {
      patch.errorMessage = args.errorMessage;
    }

    if (["completed", "failed", "cancelled"].includes(args.status)) {
      patch.completedAt = Date.now();
    }

    await ctx.db.patch(args.runId, patch);
  },
});

export const listRecent = query({
  args: { limit: v.optional(v.int64()) },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const rawLimit = Number(args.limit ?? BigInt(25));
    const safeLimit = Math.min(Math.max(rawLimit, 1), 100);

    return await ctx.db
      .query("runs")
      .withIndex("by_user_and_started_at", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(safeLimit);
  },
});

export const listByRepo = query({
  args: { repoId: v.id("repos") },
  handler: async (ctx, args) => {
    await requireRepoAccess(ctx, args.repoId);

    return await ctx.db
      .query("runs")
      .withIndex("by_repo", (q) => q.eq("repoId", args.repoId))
      .order("desc")
      .take(50);
  },
});

export const getByRunId = query({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const run = await ctx.db
      .query("runs")
      .withIndex("by_run_id", (q) => q.eq("runId", args.runId))
      .unique();

    if (!run) {
      return null;
    }

    const repo = await ctx.db.get(run.repoId);

    if (!repo || repo.userId !== user._id) {
      throw new Error("Not authorized for run");
    }

    return run;
  },
});
