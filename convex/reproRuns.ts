import { v } from "convex/values";

import { query } from "./_generated/server";
import { requireRepoAccess, requireRunAccess } from "./lib/auth";

function normalizeLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 20, 1), 100);
}

export const getByRunId = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    await requireRunAccess(ctx, args.runId);

    return await ctx.db
      .query("reproRuns")
      .withIndex("by_run", (query) => query.eq("runId", args.runId))
      .order("desc")
      .first();
  },
});

export const listByRepo = query({
  args: {
    repoId: v.id("repos"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireRepoAccess(ctx, args.repoId);

    const results = [];
    const limit = normalizeLimit(args.limit);

    for await (const run of ctx.db
      .query("runs")
      .withIndex("by_repo", (query) => query.eq("repoId", args.repoId))
      .order("desc")) {
      const latest = await ctx.db
        .query("reproRuns")
        .withIndex("by_run", (query) => query.eq("runId", run._id))
        .order("desc")
        .first();

      if (latest) {
        results.push(latest);
      }

      if (results.length >= limit) {
        break;
      }
    }

    return results;
  },
});
