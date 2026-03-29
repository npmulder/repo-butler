import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { mutation } from "./_generated/server";
import { requireRunAccess } from "./lib/auth";

const approvalActionValidator = v.union(
  v.literal("approve"),
  v.literal("reject"),
  v.literal("request_info"),
);

function stripSystemFields(run: Doc<"runs">) {
  const doc = { ...run } as Record<string, unknown>;

  delete doc._creationTime;
  delete doc._id;

  return doc as Omit<Doc<"runs">, "_creationTime" | "_id">;
}

export const processApproval = mutation({
  args: {
    runId: v.id("runs"),
    action: approvalActionValidator,
  },
  handler: async (ctx, args) => {
    const { run } = await requireRunAccess(ctx, args.runId);

    if (run.status !== "awaiting_approval") {
      throw new Error("Run is not awaiting approval");
    }

    const now = Date.now();

    if (args.action === "approve") {
      const nextRun = stripSystemFields(run);

      delete nextRun.errorMessage;

      await ctx.db.replace(run._id, {
        ...nextRun,
        status: "reproducing",
        approvalDecision: "approved",
        approvalUpdatedAt: now,
      });

      return {
        approvalDecision: "approved" as const,
        status: "reproducing" as const,
      };
    }

    if (args.action === "reject") {
      await ctx.db.patch(run._id, {
        status: "cancelled",
        approvalDecision: "rejected",
        approvalUpdatedAt: now,
        errorMessage: "Approval rejected from the triage dashboard.",
      });

      return {
        approvalDecision: "rejected" as const,
        status: "cancelled" as const,
      };
    }

    await ctx.db.patch(run._id, {
      approvalDecision: "request_info",
      approvalUpdatedAt: now,
      errorMessage:
        "Additional maintainer context requested before sandbox reproduction.",
    });

    return {
      approvalDecision: "request_info" as const,
      status: "awaiting_approval" as const,
    };
  },
});
