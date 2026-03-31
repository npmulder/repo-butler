import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";

const reportTypeValidator = v.union(
  v.literal("triage"),
  v.literal("verification"),
);
const reportStatusValidator = v.union(
  v.literal("posting"),
  v.literal("posted"),
  v.literal("failed"),
);
type ReportStatus = "posting" | "posted" | "failed";
type ClaimReportResult = {
  reportId: Id<"reports">;
  shouldPost: boolean;
  status: ReportStatus;
};

async function getLatestReport(
  ctx: QueryCtx | MutationCtx,
  runId: Id<"runs">,
) {
  const reports = await ctx.db
    .query("reports")
    .withIndex("by_run", (query) => query.eq("runId", runId))
    .order("desc")
    .take(10);

  if (reports.length > 1) {
    console.warn(
      `[reports] Found ${reports.length} records for run ${runId}; preferring a row with a posted comment.`,
    );
  }

  return reports.find((report) => report.commentId !== undefined) ?? reports[0] ?? null;
}

export const claimReport = internalMutation({
  args: {
    runId: v.id("runs"),
    reportType: reportTypeValidator,
  },
  returns: v.object({
    reportId: v.id("reports"),
    shouldPost: v.boolean(),
    status: reportStatusValidator,
  }),
  handler: async (ctx, args): Promise<ClaimReportResult> => {
    const existing = await getLatestReport(ctx, args.runId);
    const now = Date.now();

    if (existing) {
      if (
        existing.commentId !== undefined ||
        existing.status === "posted" ||
        existing.status === "posting"
      ) {
        return {
          reportId: existing._id,
          shouldPost: false,
          status:
            existing.commentId !== undefined
              ? "posted"
              : (existing.status as ReportStatus),
        };
      }

      await ctx.db.patch(existing._id, {
        reportType: args.reportType,
        status: "posting",
        labelsApplied: [],
        updatedAt: now,
      });

      return {
        reportId: existing._id,
        shouldPost: true,
        status: "posting",
      };
    }

    const reportId = await ctx.db.insert("reports", {
      runId: args.runId,
      labelsApplied: [],
      reportType: args.reportType,
      status: "posting",
      createdAt: now,
      updatedAt: now,
    });

    return {
      reportId,
      shouldPost: true,
      status: "posting",
    };
  },
});

export const recordReport = internalMutation({
  args: {
    runId: v.id("runs"),
    commentId: v.number(),
    labelsApplied: v.array(v.string()),
    reportType: reportTypeValidator,
  },
  returns: v.id("reports"),
  handler: async (ctx, args) => {
    const existing = await getLatestReport(ctx, args.runId);
    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        commentId: args.commentId,
        labelsApplied: args.labelsApplied,
        reportType: args.reportType,
        status: "posted",
        updatedAt: now,
      });

      return existing._id;
    }

    return await ctx.db.insert("reports", {
      ...args,
      status: "posted",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const markReportFailed = internalMutation({
  args: {
    runId: v.id("runs"),
    reportType: reportTypeValidator,
  },
  returns: v.id("reports"),
  handler: async (ctx, args) => {
    const existing = await getLatestReport(ctx, args.runId);
    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        reportType: args.reportType,
        status: "failed",
        updatedAt: now,
      });

      return existing._id;
    }

    return await ctx.db.insert("reports", {
      runId: args.runId,
      labelsApplied: [],
      reportType: args.reportType,
      status: "failed",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const getByRunId = internalQuery({
  args: {
    runId: v.id("runs"),
  },
  handler: async (ctx, args) => {
    return await getLatestReport(ctx, args.runId);
  },
});
