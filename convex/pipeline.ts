import { v } from "convex/values";
import { internalAction } from "./_generated/server";

export const runTriage = internalAction({
  args: { runDocId: v.id("runs") },
  returns: v.null(),
  handler: async (_ctx, args) => {
    console.log(`[pipeline] Triage started for run ${args.runDocId}`);
    return null;
  },
});
