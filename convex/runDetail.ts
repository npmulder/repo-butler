import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { requireRunAccess } from "./lib/auth";

const MAX_REPRO_RUNS = 8;

async function listReproRuns(
  ctx: QueryCtx,
  runId: Id<"runs">,
) {
  const reproRuns: Array<Doc<"reproRuns"> & { logUrl: string | null }> = [];

  for await (const reproRun of ctx.db
    .query("reproRuns")
    .withIndex("by_run", (indexQuery) => indexQuery.eq("runId", runId))
    .order("desc")) {
    reproRuns.push({
      ...reproRun,
      logUrl: reproRun.logStorageId
        ? await ctx.storage.getUrl(reproRun.logStorageId)
        : null,
    });

    if (reproRuns.length >= MAX_REPRO_RUNS) {
      break;
    }
  }

  return reproRuns.reverse();
}

export const getFullRunDetail = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const { repo, run } = await requireRunAccess(ctx, args.runId);
    const [issue, repoSettings, triage, reproContract, reproPlan, reproRuns, verification] =
      await Promise.all([
        ctx.db.get(run.issueId),
        ctx.db
          .query("repoSettings")
          .withIndex("by_repo", (indexQuery) => indexQuery.eq("repoId", run.repoId))
          .unique(),
        ctx.db
          .query("triageResults")
          .withIndex("by_run", (indexQuery) => indexQuery.eq("runId", args.runId))
          .unique(),
        ctx.db
          .query("reproContracts")
          .withIndex("by_run", (indexQuery) => indexQuery.eq("runId", args.runId))
          .unique(),
        ctx.db
          .query("reproPlans")
          .withIndex("by_run", (indexQuery) => indexQuery.eq("runId", args.runId))
          .unique(),
        listReproRuns(ctx, args.runId),
        ctx.db
          .query("verifications")
          .withIndex("by_run", (indexQuery) => indexQuery.eq("runId", args.runId))
          .unique(),
      ]);

    return {
      run,
      issue,
      repo,
      repoSettings,
      triage,
      reproContract,
      reproPlan,
      reproRuns,
      latestReproRun: reproRuns.at(-1) ?? null,
      verification: verification
        ? {
            ...verification,
            logUrl: verification.logStorageId
              ? await ctx.storage.getUrl(verification.logStorageId)
              : null,
          }
        : null,
    };
  },
});
