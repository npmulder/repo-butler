import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { requireRepoAccess } from "./lib/auth";

const issueStateValidator = v.union(v.literal("open"), v.literal("closed"));

const commentsSnapshotValidator = v.array(
  v.object({
    authorLogin: v.string(),
    body: v.string(),
    createdAt: v.string(),
  }),
);

export const snapshot = internalMutation({
  args: {
    repoId: v.id("repos"),
    githubIssueNumber: v.int64(),
    githubIssueUrl: v.string(),
    title: v.string(),
    body: v.optional(v.string()),
    authorLogin: v.string(),
    labels: v.array(v.string()),
    state: issueStateValidator,
    commentsSnapshot: v.optional(commentsSnapshotValidator),
    linkedPRs: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const repo = await ctx.db.get(args.repoId);

    if (!repo) {
      throw new Error("Repo not found");
    }

    const now = Date.now();

    return await ctx.db.insert("issues", {
      repoId: args.repoId,
      githubIssueNumber: args.githubIssueNumber,
      githubIssueUrl: args.githubIssueUrl,
      title: args.title,
      authorLogin: args.authorLogin,
      labels: args.labels,
      state: args.state,
      ...(args.body !== undefined ? { body: args.body } : {}),
      ...(args.commentsSnapshot !== undefined
        ? { commentsSnapshot: args.commentsSnapshot }
        : {}),
      ...(args.linkedPRs !== undefined ? { linkedPRs: args.linkedPRs } : {}),
      snapshotedAt: now,
      createdAt: now,
    });
  },
});

export const getByGithubIssue = query({
  args: { repoId: v.id("repos"), githubIssueNumber: v.int64() },
  handler: async (ctx, args) => {
    await requireRepoAccess(ctx, args.repoId);

    return await ctx.db
      .query("issues")
      .withIndex("by_repo_and_github_issue_number_and_snapshoted_at", (q) =>
        q
          .eq("repoId", args.repoId)
          .eq("githubIssueNumber", args.githubIssueNumber),
      )
      .order("desc")
      .first();
  },
});

export const getById = internalQuery({
  args: { issueId: v.id("issues") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.issueId);
  },
});

export const listByRepo = query({
  args: { repoId: v.id("repos") },
  handler: async (ctx, args) => {
    await requireRepoAccess(ctx, args.repoId);

    return await ctx.db
      .query("issues")
      .withIndex("by_repo", (q) => q.eq("repoId", args.repoId))
      .order("desc")
      .take(50);
  },
});
