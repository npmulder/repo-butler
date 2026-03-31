import { v } from "convex/values";

import type { ReproContract } from "../lib/prompts/verifier";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { internalQuery, query } from "./_generated/server";
import { requireRunAccess } from "./lib/auth";

async function loadContractArtifact(
  ctx: QueryCtx,
  runId: Id<"runs">,
): Promise<ReproContract | null> {
  const run = await ctx.db.get(runId);

  if (!run) {
    return null;
  }

  const contract = await ctx.db
    .query("reproContracts")
    .withIndex("by_run", (query) => query.eq("runId", runId))
    .unique();

  if (!contract) {
    return null;
  }

  return {
    schema_version: contract.schemaVersion as ReproContract["schema_version"],
    run_id: run.runId,
    acceptance: {
      artifact_type: contract.acceptance.artifactType,
      must_fail_on_base_revision: contract.acceptance.mustFailOnBaseRevision,
      must_be_deterministic: {
        reruns: Number(contract.acceptance.mustBeDeterministic.reruns),
        allowed_flake_rate:
          contract.acceptance.mustBeDeterministic.allowedFlakeRate,
      },
      must_not_require_network: contract.acceptance.mustNotRequireNetwork,
      failure_signal: {
        kind: contract.acceptance.failureSignal.kind,
        ...(contract.acceptance.failureSignal.matchAny !== undefined
          ? {
              stderr_match_any: [...contract.acceptance.failureSignal.matchAny],
            }
          : {}),
      },
    },
    sandbox_policy: {
      network: contract.sandboxPolicy.network,
      run_as_root: contract.sandboxPolicy.runAsRoot,
      secrets_mount: contract.sandboxPolicy.secretsMount,
    },
    budgets: {
      wall_clock_seconds: Number(contract.budgets.wallClockSeconds),
      max_iterations: Number(contract.budgets.maxIterations),
    },
  };
}

export const getByRunId = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    await requireRunAccess(ctx, args.runId);

    return await loadContractArtifact(ctx, args.runId);
  },
});

export const getInternalByRunId = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    return await loadContractArtifact(ctx, args.runId);
  },
});
