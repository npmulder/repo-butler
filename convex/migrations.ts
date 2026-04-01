import { Migrations } from "@convex-dev/migrations";

import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";

export const migrations = new Migrations<DataModel>(components.migrations);

export const backfillRunReproMetadata = migrations.define({
  table: "runs",
  migrateOne: async (ctx, run) => {
    const latestReproRun = await ctx.db
      .query("reproRuns")
      .withIndex("by_run", (query) => query.eq("runId", run._id))
      .order("desc")
      .first();

    if (!latestReproRun) {
      if (
        run.hasReproRun === undefined &&
        run.latestReproRunId === undefined
      ) {
        return;
      }

      return {
        hasReproRun: undefined,
        latestReproRunId: undefined,
      };
    }

    if (
      run.hasReproRun === true &&
      run.latestReproRunId === latestReproRun._id
    ) {
      return;
    }

    return {
      hasReproRun: true,
      latestReproRunId: latestReproRun._id,
    };
  },
});

export const markReposWithReproMetadataBackfill = migrations.define({
  table: "repos",
  migrateOne: (_ctx, repo) => {
    if (repo.reproRunMetadataBackfilledAt !== undefined) {
      return;
    }

    return {
      reproRunMetadataBackfilledAt: Date.now(),
    };
  },
});

export const runReproRunMetadataBackfill = migrations.runner();
