import { v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server";

const reportTypeValidator = v.union(
  v.literal("triage"),
  v.literal("verification"),
);

export const recordReport = internalMutation({
  args: {
    runId: v.id("runs"),
    commentId: v.number(),
    labelsApplied: v.array(v.string()),
    reportType: reportTypeValidator,
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("reports", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const getByRunId = internalQuery({
  args: {
    runId: v.id("runs"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("reports")
      .withIndex("by_run", (query) => query.eq("runId", args.runId))
      .unique();
  },
});
