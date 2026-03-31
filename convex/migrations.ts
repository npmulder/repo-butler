import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";

import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { internalQuery } from "./_generated/server";

export const migrations = new Migrations<DataModel>(components.migrations);

export const backfillIssueSnapshottedAt = migrations.define({
  table: "issues",
  batchSize: 50,
  migrateOne: (_ctx, issue) => {
    if (issue.snapshottedAt !== undefined) {
      return;
    }

    return {
      snapshottedAt: issue.snapshotedAt ?? issue.createdAt,
    };
  },
});

export const cleanupLegacyIssueSnapshotedAt = migrations.define({
  table: "issues",
  batchSize: 50,
  migrateOne: (_ctx, issue) => {
    if (issue.snapshotedAt === undefined) {
      return;
    }

    return {
      snapshottedAt:
        issue.snapshottedAt ?? issue.snapshotedAt ?? issue.createdAt,
      snapshotedAt: undefined,
    };
  },
});

export const runIssueSnapshotTimestampBackfill = migrations.runner(
  internal.migrations.backfillIssueSnapshottedAt,
);

export const runIssueSnapshotTimestampCleanup = migrations.runner(
  internal.migrations.cleanupLegacyIssueSnapshotedAt,
);

export const runIssueSnapshotTimestampMigrations = migrations.runner([
  internal.migrations.backfillIssueSnapshottedAt,
  internal.migrations.cleanupLegacyIssueSnapshotedAt,
]);

export const auditIssueSnapshotTimestampFields = internalQuery({
  args: {
    limit: v.optional(v.number()),
    scanLimit: v.optional(v.number()),
  },
  returns: v.object({
    complete: v.boolean(),
    legacySnapshotedAtIssueIds: v.array(v.id("issues")),
    missingSnapshottedAtIssueIds: v.array(v.id("issues")),
    scanned: v.number(),
  }),
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
    const scanLimit = Math.min(Math.max(args.scanLimit ?? limit, limit), 5000);
    const legacySnapshotedAtIssueIds = [];
    const missingSnapshottedAtIssueIds = [];
    let scanned = 0;

    for await (const issue of ctx.db
      .query("issues")
      .withIndex("by_created")
      .order("desc")) {
      scanned += 1;

      if (
        issue.snapshottedAt === undefined &&
        missingSnapshottedAtIssueIds.length < limit
      ) {
        missingSnapshottedAtIssueIds.push(issue._id);
      }

      if (
        issue.snapshotedAt !== undefined &&
        legacySnapshotedAtIssueIds.length < limit
      ) {
        legacySnapshotedAtIssueIds.push(issue._id);
      }

      if (
        scanned >= scanLimit ||
        (missingSnapshottedAtIssueIds.length >= limit &&
          legacySnapshotedAtIssueIds.length >= limit)
      ) {
        break;
      }
    }

    return {
      complete:
        missingSnapshottedAtIssueIds.length === 0 &&
        legacySnapshotedAtIssueIds.length === 0,
      legacySnapshotedAtIssueIds,
      missingSnapshottedAtIssueIds,
      scanned,
    };
  },
});
