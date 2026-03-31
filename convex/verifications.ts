import { v } from "convex/values";

import { internalQuery, query } from "./_generated/server";
import { requireRepoAccess, requireRunAccess } from "./lib/auth";

function normalizeLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 20, 1), 100);
}

export const getByRunId = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    await requireRunAccess(ctx, args.runId);

    return await ctx.db
      .query("verifications")
      .withIndex("by_run", (query) => query.eq("runId", args.runId))
      .unique();
  },
});

export const getInternalByRunId = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("verifications")
      .withIndex("by_run", (query) => query.eq("runId", args.runId))
      .unique();
  },
});

export const listVerified = query({
  args: {
    repoId: v.id("repos"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireRepoAccess(ctx, args.repoId);

    const limit = normalizeLimit(args.limit);
    const verifications = [];

    for await (const run of ctx.db
      .query("runs")
      .withIndex("by_repo", (query) => query.eq("repoId", args.repoId))
      .order("desc")) {
      if (verifications.length >= limit) {
        break;
      }

      const verification = await ctx.db
        .query("verifications")
        .withIndex("by_run", (query) => query.eq("runId", run._id))
        .unique();

      if (verification?.verdict === "reproduced") {
        verifications.push(verification);
      }
    }

    return verifications;
  },
});
