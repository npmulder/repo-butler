import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { query } from "./_generated/server";
import {
  requireCurrentUser,
  requireRepoAccess,
  requireRunAccess,
} from "./lib/auth";

const classificationTypeValidator = v.union(
  v.literal("bug"),
  v.literal("docs"),
  v.literal("question"),
  v.literal("feature"),
  v.literal("build"),
  v.literal("test"),
);

function normalizeLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 20, 1), 100);
}

export const getByRunId = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    await requireRunAccess(ctx, args.runId);

    return await ctx.db
      .query("triageResults")
      .withIndex("by_run", (query) => query.eq("runId", args.runId))
      .unique();
  },
});

export const listByRepo = query({
  args: {
    repoId: v.id("repos"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireRepoAccess(ctx, args.repoId);

    return await ctx.db
      .query("triageResults")
      .withIndex("by_repo", (query) => query.eq("repoId", args.repoId))
      .order("desc")
      .take(normalizeLimit(args.limit));
  },
});

export const getRecentByClassification = query({
  args: {
    classificationType: classificationTypeValidator,
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const results: Array<Doc<"triageResults">> = [];
    const safeLimit = normalizeLimit(args.limit);

    for await (const result of ctx.db
      .query("triageResults")
      .withIndex("by_classification_type", (query) =>
        query.eq("classificationType", args.classificationType),
      )
      .order("desc")) {
      if (!result.repoId) {
        continue;
      }

      const repo = await ctx.db.get(result.repoId);

      if (!repo || repo.userId !== user._id) {
        continue;
      }

      results.push(result);

      if (results.length >= safeLimit) {
        break;
      }
    }

    return results;
  },
});
