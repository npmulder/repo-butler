import { v } from "convex/values";

import { query } from "./_generated/server";
import { requireRunAccess } from "./lib/auth";

export const getByRunId = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    await requireRunAccess(ctx, args.runId);

    return await ctx.db
      .query("reproPlans")
      .withIndex("by_run", (query) => query.eq("runId", args.runId))
      .unique();
  },
});
