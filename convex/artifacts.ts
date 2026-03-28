import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireCurrentUser, requireLoadedRunAccess, requireRunAccess } from "./lib/auth";

const reproContractSchemaVersionValidator = v.literal("rb.repro_contract.v1");
const reproPlanSchemaVersionValidator = v.literal("rb.repro_plan.v1");
const reproRunSchemaVersionValidator = v.literal("rb.repro_run.v1");
const verificationSchemaVersionValidator = v.literal("rb.verification.v1");
const triageTokensUsedValidator = v.object({
  input: v.number(),
  output: v.number(),
});

const failureSignalValidator = v.object({
  kind: v.union(
    v.literal("exception"),
    v.literal("assertion"),
    v.literal("nonzero_exit"),
    v.literal("snapshot_diff"),
    v.literal("timeout"),
  ),
  matchAny: v.optional(v.array(v.string())),
});

const acceptanceValidator = v.object({
  artifactType: v.union(v.literal("test"), v.literal("script")),
  mustFailOnBaseRevision: v.boolean(),
  mustBeDeterministic: v.object({
    reruns: v.int64(),
    allowedFlakeRate: v.float64(),
  }),
  mustNotRequireNetwork: v.boolean(),
  failureSignal: failureSignalValidator,
});

const sandboxPolicyValidator = v.object({
  network: v.union(v.literal("disabled"), v.literal("enabled")),
  runAsRoot: v.boolean(),
  secretsMount: v.union(v.literal("none"), v.literal("readonly")),
});

const budgetsValidator = v.object({
  wallClockSeconds: v.int64(),
  maxIterations: v.int64(),
});

const baseRevisionValidator = v.object({
  ref: v.string(),
  sha: v.string(),
});

const environmentStrategyValidator = v.object({
  preferred: v.string(),
  fallbacks: v.array(v.string()),
  notes: v.optional(v.string()),
});

const planCommandValidator = v.object({
  cwd: v.string(),
  cmd: v.string(),
});

const plannedArtifactValidator = v.object({
  type: v.string(),
  path: v.string(),
  entrypoint: v.optional(v.string()),
});

const sandboxValidator = v.object({
  kind: v.string(),
  imageDigest: v.optional(v.string()),
  network: v.string(),
  uid: v.optional(v.int64()),
});

const stepResultValidator = v.object({
  name: v.string(),
  cmd: v.string(),
  exitCode: v.int64(),
  stdoutSha256: v.optional(v.string()),
  stderrSha256: v.optional(v.string()),
  durationMs: v.optional(v.int64()),
});

const failureObservedValidator = v.object({
  kind: v.string(),
  matchAny: v.optional(v.array(v.string())),
  traceExcerptSha256: v.optional(v.string()),
});

const verdictValidator = v.union(
  v.literal("reproduced"),
  v.literal("not_reproduced"),
  v.literal("flaky"),
  v.literal("policy_violation"),
  v.literal("env_setup_failed"),
  v.literal("budget_exhausted"),
);

const determinismValidator = v.object({
  reruns: v.int64(),
  fails: v.int64(),
  flakeRate: v.float64(),
});

const policyChecksValidator = v.object({
  networkUsed: v.boolean(),
  secretsAccessed: v.boolean(),
  writesOutsideWorkspace: v.boolean(),
});

const evidenceValidator = v.object({
  failingCmd: v.string(),
  exitCode: v.int64(),
  stderrSha256: v.optional(v.string()),
});

async function findSingleRunIdForLogStorage(
  ctx: QueryCtx,
  storageId: Id<"_storage">,
): Promise<Id<"runs"> | null> {
  const runIds = new Set<Id<"runs">>();

  for await (const reproRun of ctx.db
    .query("reproRuns")
    .withIndex("by_log_storage_id", (q) => q.eq("logStorageId", storageId))) {
    runIds.add(reproRun.runId);

    if (runIds.size > 1) {
      throw new Error("Log storage ID is referenced by multiple runs");
    }
  }

  for await (const verification of ctx.db
    .query("verifications")
    .withIndex("by_log_storage_id", (q) => q.eq("logStorageId", storageId))) {
    runIds.add(verification.runId);

    if (runIds.size > 1) {
      throw new Error("Log storage ID is referenced by multiple runs");
    }
  }

  return runIds.values().next().value ?? null;
}

export const storeTriage = internalMutation({
  args: {
    runId: v.id("runs"),
    artifact: v.any(),
    tokensUsed: triageTokensUsedValidator,
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);

    if (!run) {
      throw new Error("Run not found");
    }

    const existing = await ctx.db
      .query("triageResults")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .unique();
    const createdAt = existing?.createdAt ?? Date.now();
    const legacyClassification = {
      type: args.artifact.classification.type,
      ...(args.artifact.classification.area !== undefined
        ? { area: args.artifact.classification.area }
        : {}),
      ...(args.artifact.classification.severity !== undefined
        ? { severity: args.artifact.classification.severity }
        : {}),
      labelsSuggested: args.artifact.classification.labels_suggested,
      confidence: args.artifact.classification.confidence,
    };
    const legacyReproHypothesis = {
      ...(args.artifact.repro_hypothesis.minimal_steps_guess !== undefined
        ? { minimalStepsGuess: args.artifact.repro_hypothesis.minimal_steps_guess }
        : {}),
      expectedFailureSignal: {
        kind: args.artifact.repro_hypothesis.expected_failure_signal.kind,
        ...(args.artifact.repro_hypothesis.expected_failure_signal.match_any !== undefined
          ? {
              matchAny:
                args.artifact.repro_hypothesis.expected_failure_signal.match_any,
            }
          : {}),
      },
      ...(args.artifact.repro_hypothesis.environment_assumptions !== undefined
        ? {
            environmentAssumptions:
              args.artifact.repro_hypothesis.environment_assumptions,
          }
        : {}),
    };
    const doc = {
      runId: args.runId,
      repoId: run.repoId,
      issueId: run.issueId,
      artifact: args.artifact,
      classificationType: args.artifact.classification.type,
      ...(args.artifact.classification.severity !== undefined
        ? { severity: args.artifact.classification.severity }
        : {}),
      confidence: args.artifact.classification.confidence,
      reproEligible: args.artifact.repro_eligible,
      summary: args.artifact.summary,
      tokensUsed: args.tokensUsed,
      schemaVersion: args.artifact.schema_version,
      classification: legacyClassification,
      reproHypothesis: legacyReproHypothesis,
      ...(existing?.rawResponse !== undefined
        ? { rawResponse: existing.rawResponse }
        : {}),
      createdAt,
    };

    if (existing) {
      await ctx.db.replace(existing._id, doc);
      return existing._id;
    }

    return await ctx.db.insert("triageResults", doc);
  },
});

export const storeReproContract = mutation({
  args: {
    runId: v.id("runs"),
    schemaVersion: reproContractSchemaVersionValidator,
    acceptance: acceptanceValidator,
    sandboxPolicy: sandboxPolicyValidator,
    budgets: budgetsValidator,
  },
  handler: async (ctx, args) => {
    await requireRunAccess(ctx, args.runId);

    const existing = await ctx.db
      .query("reproContracts")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .unique();
    const createdAt = existing?.createdAt ?? Date.now();
    const doc = {
      runId: args.runId,
      schemaVersion: args.schemaVersion,
      acceptance: args.acceptance,
      sandboxPolicy: args.sandboxPolicy,
      budgets: args.budgets,
      createdAt,
    };

    if (existing) {
      await ctx.db.replace(existing._id, doc);
      return existing._id;
    }

    return await ctx.db.insert("reproContracts", doc);
  },
});

export const storeReproPlan = mutation({
  args: {
    runId: v.id("runs"),
    schemaVersion: reproPlanSchemaVersionValidator,
    baseRevision: baseRevisionValidator,
    environmentStrategy: environmentStrategyValidator,
    commands: v.array(planCommandValidator),
    artifact: plannedArtifactValidator,
  },
  handler: async (ctx, args) => {
    await requireRunAccess(ctx, args.runId);

    const existing = await ctx.db
      .query("reproPlans")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .unique();
    const createdAt = existing?.createdAt ?? Date.now();
    const doc = {
      runId: args.runId,
      schemaVersion: args.schemaVersion,
      baseRevision: args.baseRevision,
      environmentStrategy: args.environmentStrategy,
      commands: args.commands,
      artifact: args.artifact,
      createdAt,
    };

    await ctx.db.patch(args.runId, { status: "reproducing" });

    if (existing) {
      await ctx.db.replace(existing._id, doc);
      return existing._id;
    }

    return await ctx.db.insert("reproPlans", doc);
  },
});

export const storeReproRun = mutation({
  args: {
    runId: v.id("runs"),
    schemaVersion: reproRunSchemaVersionValidator,
    iteration: v.int64(),
    sandbox: sandboxValidator,
    steps: v.array(stepResultValidator),
    failureObserved: v.optional(failureObservedValidator),
    artifactContent: v.optional(v.string()),
    logStorageId: v.optional(v.id("_storage")),
    durationMs: v.int64(),
  },
  handler: async (ctx, args) => {
    await requireRunAccess(ctx, args.runId);

    const existing = await ctx.db
      .query("reproRuns")
      .withIndex("by_run", (q) => q.eq("runId", args.runId).eq("iteration", args.iteration))
      .unique();
    const createdAt = existing?.createdAt ?? Date.now();
    const doc = {
      runId: args.runId,
      schemaVersion: args.schemaVersion,
      iteration: args.iteration,
      sandbox: args.sandbox,
      steps: args.steps,
      ...(args.failureObserved !== undefined ? { failureObserved: args.failureObserved } : {}),
      ...(args.artifactContent !== undefined ? { artifactContent: args.artifactContent } : {}),
      ...(args.logStorageId !== undefined ? { logStorageId: args.logStorageId } : {}),
      durationMs: args.durationMs,
      createdAt,
    };

    if (existing) {
      await ctx.db.replace(existing._id, doc);
      return existing._id;
    }

    return await ctx.db.insert("reproRuns", doc);
  },
});

export const storeVerification = mutation({
  args: {
    runId: v.id("runs"),
    schemaVersion: verificationSchemaVersionValidator,
    verdict: verdictValidator,
    determinism: determinismValidator,
    policyChecks: policyChecksValidator,
    evidence: evidenceValidator,
    notes: v.optional(v.string()),
    logStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    await requireRunAccess(ctx, args.runId);

    const existing = await ctx.db
      .query("verifications")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .unique();
    const createdAt = existing?.createdAt ?? Date.now();
    const doc = {
      runId: args.runId,
      schemaVersion: args.schemaVersion,
      verdict: args.verdict,
      determinism: args.determinism,
      policyChecks: args.policyChecks,
      evidence: args.evidence,
      ...(args.notes !== undefined ? { notes: args.notes } : {}),
      ...(args.logStorageId !== undefined ? { logStorageId: args.logStorageId } : {}),
      createdAt,
    };

    await ctx.db.patch(args.runId, {
      status: args.verdict === "reproduced" ? "completed" : "failed",
      verdict: args.verdict,
      completedAt: Date.now(),
    });

    if (existing) {
      await ctx.db.replace(existing._id, doc);
      return existing._id;
    }

    return await ctx.db.insert("verifications", doc);
  },
});

export const getRunBundle = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const run = await ctx.db.get(args.runId);

    if (!run) {
      return null;
    }

    await requireLoadedRunAccess(ctx, user, run);

    const [triage, contract, plan, reproRuns, verification, issue] = await Promise.all([
      ctx.db
        .query("triageResults")
        .withIndex("by_run", (q) => q.eq("runId", args.runId))
        .unique(),
      ctx.db
        .query("reproContracts")
        .withIndex("by_run", (q) => q.eq("runId", args.runId))
        .unique(),
      ctx.db
        .query("reproPlans")
        .withIndex("by_run", (q) => q.eq("runId", args.runId))
        .unique(),
      ctx.db
        .query("reproRuns")
        .withIndex("by_run", (q) => q.eq("runId", args.runId))
        .order("asc")
        .collect(),
      ctx.db
        .query("verifications")
        .withIndex("by_run", (q) => q.eq("runId", args.runId))
        .unique(),
      ctx.db.get(run.issueId),
    ]);

    return {
      run,
      issue,
      triage,
      contract,
      plan,
      reproRuns,
      verification,
    };
  },
});

export const generateUploadUrl = mutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    await requireRunAccess(ctx, args.runId);
    return await ctx.storage.generateUploadUrl();
  },
});

export const getLogUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const runId = await findSingleRunIdForLogStorage(ctx, args.storageId);

    if (!runId) {
      return null;
    }

    const run = await ctx.db.get(runId);

    if (!run) {
      return null;
    }

    await requireLoadedRunAccess(ctx, user, run);

    return await ctx.storage.getUrl(args.storageId);
  },
});
