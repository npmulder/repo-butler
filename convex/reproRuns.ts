import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { internalQuery, query, type QueryCtx } from "./_generated/server";
import { requireRepoAccess, requireRunAccess } from "./lib/auth";

function normalizeLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 20, 1), 100);
}

type ReproRunEntry = {
  reproRun: Doc<"reproRuns">;
  runId: Doc<"runs">["_id"];
  startedAt: Doc<"runs">["startedAt"];
};

function compareReproRunEntries(left: ReproRunEntry, right: ReproRunEntry) {
  if (right.startedAt !== left.startedAt) {
    return right.startedAt - left.startedAt;
  }

  const leftId = String(left.runId);
  const rightId = String(right.runId);

  if (leftId < rightId) {
    return -1;
  }

  if (leftId > rightId) {
    return 1;
  }

  return 0;
}

async function getLatestReproRunForRun(
  ctx: QueryCtx,
  run: Doc<"runs">,
) {
  if (run.latestReproRunId) {
    const latestReproRun = await ctx.db.get(run.latestReproRunId);

    if (latestReproRun && latestReproRun.runId === run._id) {
      return latestReproRun;
    }
  }

  return await ctx.db
    .query("reproRuns")
    .withIndex("by_run", (query) => query.eq("runId", run._id))
    .order("desc")
    .first();
}

async function listLegacyLatestReproRunsByRepo(
  ctx: QueryCtx,
  repoId: Doc<"repos">["_id"],
  seenRunIds: Set<Doc<"runs">["_id"]>,
  limit: number,
) {
  const results: ReproRunEntry[] = [];

  for await (const run of ctx.db
    .query("runs")
    .withIndex("by_repo", (query) => query.eq("repoId", repoId))
    .order("desc")) {
    if (seenRunIds.has(run._id)) {
      continue;
    }

    const latestReproRun = await getLatestReproRunForRun(ctx, run);

    if (!latestReproRun) {
      continue;
    }

    results.push({
      reproRun: latestReproRun,
      runId: run._id,
      startedAt: run.startedAt,
    });
    seenRunIds.add(run._id);

    if (results.length >= limit) {
      break;
    }
  }

  return results;
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

export const getInternalByRunId = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
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
    const { repo } = await requireRepoAccess(ctx, args.repoId);

    const limit = normalizeLimit(args.limit);
    const indexedRuns = await ctx.db
      .query("runs")
      .withIndex("by_repo_and_has_repro_run_and_started_at", (query) =>
        query.eq("repoId", args.repoId).eq("hasReproRun", true),
      )
      .order("desc")
      .take(limit);
    const indexedEntries = (
      await Promise.all(
        indexedRuns.map(async (run) => {
          const reproRun = await getLatestReproRunForRun(ctx, run);

          if (!reproRun) {
            return null;
          }

          return {
            reproRun,
            runId: run._id,
            startedAt: run.startedAt,
          };
        }),
      )
    ).filter(
      (
        entry,
      ): entry is ReproRunEntry => entry !== null,
    );

    if (indexedEntries.length >= limit) {
      return indexedEntries.map((entry) => entry.reproRun);
    }

    if (repo.reproRunMetadataBackfilledAt !== undefined) {
      return indexedEntries.map((entry) => entry.reproRun);
    }

    const legacyResults = await listLegacyLatestReproRunsByRepo(
      ctx,
      args.repoId,
      new Set(indexedEntries.map((entry) => entry.runId)),
      limit - indexedEntries.length,
    );

    return [...indexedEntries, ...legacyResults]
      .sort(compareReproRunEntries)
      .slice(0, limit)
      .map((entry) => entry.reproRun);
  },
});
