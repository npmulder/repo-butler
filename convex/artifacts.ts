import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import {
  requireCurrentUser,
  requireLoadedRunAccess,
  requireRunAccess,
} from "./lib/auth";

const reproContractSchemaVersionValidator = v.literal("rb.repro_contract.v1");
const reproPlanSchemaVersionValidator = v.literal("rb.repro_plan.v1");
const reproRunSchemaVersionValidator = v.literal("rb.repro_run.v1");
const verificationSchemaVersionValidator = v.literal("rb.verification.v1");
const triageTokensUsedValidator = v.object({
  input: v.number(),
  output: v.number(),
});
const triageClassificationTypeValidator = v.union(
  v.literal("bug"),
  v.literal("docs"),
  v.literal("question"),
  v.literal("feature"),
  v.literal("build"),
  v.literal("test"),
);
const triageSeverityValidator = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
  v.literal("critical"),
);
const triageFailureSignalKindValidator = v.union(
  v.literal("exception"),
  v.literal("assertion"),
  v.literal("nonzero_exit"),
  v.literal("snapshot_diff"),
  v.literal("timeout"),
);
const triageArtifactValidator = v.object({
  schema_version: v.literal("rb.triage.v1"),
  run_id: v.string(),
  repo: v.object({
    owner: v.string(),
    name: v.string(),
    default_branch: v.string(),
  }),
  issue: v.object({
    number: v.number(),
    title: v.string(),
    url: v.string(),
  }),
  classification: v.object({
    type: triageClassificationTypeValidator,
    area: v.optional(v.array(v.string())),
    severity: v.optional(triageSeverityValidator),
    labels_suggested: v.array(v.string()),
    confidence: v.number(),
  }),
  repro_hypothesis: v.object({
    minimal_steps_guess: v.optional(v.array(v.string())),
    expected_failure_signal: v.object({
      kind: triageFailureSignalKindValidator,
      match_any: v.optional(v.array(v.string())),
    }),
    environment_assumptions: v.optional(
      v.object({
        os: v.optional(v.string()),
        language: v.optional(v.string()),
        runtime: v.optional(v.string()),
      }),
    ),
  }),
  repro_eligible: v.boolean(),
  summary: v.string(),
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

const environmentStrategyNameValidator = v.union(
  v.literal("devcontainer"),
  v.literal("dockerfile"),
  v.literal("synth_dockerfile"),
  v.literal("bootstrap"),
);

const environmentStrategyValidator = v.object({
  preferred: environmentStrategyNameValidator,
  detected: environmentStrategyNameValidator,
  fallbacks: v.array(environmentStrategyNameValidator),
  notes: v.optional(v.string()),
  imageUsed: v.optional(v.string()),
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
  stdoutTail: v.optional(v.string()),
  stderrTail: v.optional(v.string()),
  durationMs: v.optional(v.int64()),
});

const failureObservedValidator = v.object({
  kind: v.string(),
  matchAny: v.optional(v.array(v.string())),
  traceExcerptSha256: v.optional(v.string()),
});

const reproRunFailureTypeValidator = v.union(
  v.literal("env_setup"),
  v.literal("repro_failure"),
);

const reproRunEnvironmentStrategyValidator = v.object({
  attempted: environmentStrategyNameValidator,
  detected: v.optional(environmentStrategyNameValidator),
  failedAt: v.optional(v.string()),
  notes: v.optional(v.string()),
  imageUsed: v.optional(v.string()),
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
  ranAsRoot: v.boolean(),
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

async function upsertReproPlanDoc(
  ctx: MutationCtx,
  args: {
    runId: Id<"runs">;
    schemaVersion: "rb.repro_plan.v1";
    baseRevision: {
      ref: string;
      sha: string;
    };
    environmentStrategy: {
      preferred: "devcontainer" | "dockerfile" | "synth_dockerfile" | "bootstrap";
      detected: "devcontainer" | "dockerfile" | "synth_dockerfile" | "bootstrap";
      fallbacks: Array<
        "devcontainer" | "dockerfile" | "synth_dockerfile" | "bootstrap"
      >;
      notes?: string;
      imageUsed?: string;
    };
    commands: Array<{
      cwd: string;
      cmd: string;
    }>;
    artifact: {
      type: string;
      path: string;
      entrypoint?: string;
    };
  },
) {
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
}

async function upsertReproContractDoc(
  ctx: MutationCtx,
  args: {
    runId: Id<"runs">;
    schemaVersion: "rb.repro_contract.v1";
    acceptance: {
      artifactType: "test" | "script";
      mustFailOnBaseRevision: boolean;
      mustBeDeterministic: {
        reruns: bigint;
        allowedFlakeRate: number;
      };
      mustNotRequireNetwork: boolean;
      failureSignal: {
        kind:
          | "exception"
          | "assertion"
          | "nonzero_exit"
          | "snapshot_diff"
          | "timeout";
        matchAny?: string[];
      };
    };
    sandboxPolicy: {
      network: "disabled" | "enabled";
      runAsRoot: boolean;
      secretsMount: "none" | "readonly";
    };
    budgets: {
      wallClockSeconds: bigint;
      maxIterations: bigint;
    };
  },
) {
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
}

async function upsertReproRunDoc(
  ctx: MutationCtx,
  args: {
    runId: Id<"runs">;
    schemaVersion: "rb.repro_run.v1";
    iteration: bigint;
    sandbox: {
      kind: string;
      imageDigest?: string;
      network: string;
      uid?: bigint;
    };
    steps: Array<{
      name: string;
      cmd: string;
      exitCode: bigint;
      stdoutSha256?: string;
      stderrSha256?: string;
      durationMs?: bigint;
    }>;
    failureObserved?: {
      kind: string;
      matchAny?: string[];
      traceExcerptSha256?: string;
    };
    failureType?: "env_setup" | "repro_failure";
    environmentStrategy?: {
      attempted: "devcontainer" | "dockerfile" | "synth_dockerfile" | "bootstrap";
      detected?: "devcontainer" | "dockerfile" | "synth_dockerfile" | "bootstrap";
      failedAt?: string;
      notes?: string;
      imageUsed?: string;
    };
    artifactContent?: string;
    logStorageId?: Id<"_storage">;
    durationMs: bigint;
  },
) {
  const existing = await ctx.db
    .query("reproRuns")
    .withIndex("by_run", (q) =>
      q.eq("runId", args.runId).eq("iteration", args.iteration),
    )
    .unique();
  const createdAt = existing?.createdAt ?? Date.now();
  const doc = {
    runId: args.runId,
    schemaVersion: args.schemaVersion,
    iteration: args.iteration,
    sandbox: args.sandbox,
    steps: args.steps,
    ...(args.failureObserved !== undefined
      ? { failureObserved: args.failureObserved }
      : {}),
    ...(args.failureType !== undefined
      ? { failureType: args.failureType }
      : {}),
    ...(args.environmentStrategy !== undefined
      ? { environmentStrategy: args.environmentStrategy }
      : {}),
    ...(args.artifactContent !== undefined
      ? { artifactContent: args.artifactContent }
      : {}),
    ...(args.logStorageId !== undefined
      ? { logStorageId: args.logStorageId }
      : {}),
    durationMs: args.durationMs,
    createdAt,
  };

  if (existing) {
    await ctx.db.replace(existing._id, doc);
    return existing._id;
  }

  return await ctx.db.insert("reproRuns", doc);
}

async function syncRunLatestReproRun(
  ctx: MutationCtx,
  runId: Id<"runs">,
) {
  const latestReproRun = await ctx.db
    .query("reproRuns")
    .withIndex("by_run", (q) => q.eq("runId", runId))
    .order("desc")
    .first();

  if (!latestReproRun) {
    return;
  }

  const run = await ctx.db.get(runId);

  if (!run) {
    throw new Error("Run not found");
  }

  if (
    run.hasReproRun === true &&
    run.latestReproRunId === latestReproRun._id
  ) {
    return;
  }

  await ctx.db.patch(runId, {
    hasReproRun: true,
    latestReproRunId: latestReproRun._id,
  });
}

async function upsertVerificationDoc(
  ctx: MutationCtx,
  args: {
    runId: Id<"runs">;
    schemaVersion: "rb.verification.v1";
    verdict:
      | "reproduced"
      | "not_reproduced"
      | "flaky"
      | "policy_violation"
      | "env_setup_failed"
      | "budget_exhausted";
    determinism: {
      reruns: bigint;
      fails: bigint;
      flakeRate: number;
    };
    policyChecks: {
      networkUsed: boolean;
      secretsAccessed: boolean;
      writesOutsideWorkspace: boolean;
      ranAsRoot: boolean;
    };
    evidence: {
      failingCmd: string;
      exitCode: bigint;
      stderrSha256?: string;
    };
    notes?: string;
    logStorageId?: Id<"_storage">;
  },
  options: {
    patchRunStatus: boolean;
  } = { patchRunStatus: true },
) {
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
    ...(args.logStorageId !== undefined
      ? { logStorageId: args.logStorageId }
      : {}),
    createdAt,
  };

  if (options.patchRunStatus) {
    await ctx.db.patch(args.runId, {
      status: args.verdict === "reproduced" ? "completed" : "failed",
      verdict: args.verdict,
      completedAt: Date.now(),
    });
  }

  if (existing) {
    await ctx.db.replace(existing._id, doc);
    return existing._id;
  }

  return await ctx.db.insert("verifications", doc);
}

export const storeTriage = internalMutation({
  args: {
    runId: v.id("runs"),
    artifact: triageArtifactValidator,
    tokensUsed: triageTokensUsedValidator,
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);

    if (!run) {
      throw new Error("Run not found");
    }
    const artifact = args.artifact;

    if (artifact.classification.labels_suggested.length === 0) {
      throw new Error(
        "Invalid triage artifact: classification.labels_suggested must not be empty",
      );
    }

    if (
      artifact.classification.confidence < 0 ||
      artifact.classification.confidence > 1
    ) {
      throw new Error(
        "Invalid triage artifact: classification.confidence must be between 0 and 1",
      );
    }

    if (artifact.summary.trim().length === 0) {
      throw new Error("Invalid triage artifact: summary must not be empty");
    }

    const existing = await ctx.db
      .query("triageResults")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .unique();
    const createdAt = existing?.createdAt ?? Date.now();
    const legacyClassification = {
      type: artifact.classification.type,
      ...(artifact.classification.area !== undefined
        ? { area: artifact.classification.area }
        : {}),
      ...(artifact.classification.severity !== undefined
        ? { severity: artifact.classification.severity }
        : {}),
      labelsSuggested: artifact.classification.labels_suggested,
      confidence: artifact.classification.confidence,
    };
    const legacyReproHypothesis = {
      ...(artifact.repro_hypothesis.minimal_steps_guess !== undefined
        ? { minimalStepsGuess: artifact.repro_hypothesis.minimal_steps_guess }
        : {}),
      expectedFailureSignal: {
        kind: artifact.repro_hypothesis.expected_failure_signal.kind,
        ...(artifact.repro_hypothesis.expected_failure_signal.match_any !==
        undefined
          ? {
              matchAny:
                artifact.repro_hypothesis.expected_failure_signal.match_any,
            }
          : {}),
      },
      ...(artifact.repro_hypothesis.environment_assumptions !== undefined
        ? {
            environmentAssumptions:
              artifact.repro_hypothesis.environment_assumptions,
          }
        : {}),
    };
    const doc = {
      runId: args.runId,
      ...(run.userId !== undefined ? { userId: run.userId } : {}),
      repoId: run.repoId,
      issueId: run.issueId,
      artifact,
      classificationType: artifact.classification.type,
      ...(artifact.classification.severity !== undefined
        ? { severity: artifact.classification.severity }
        : {}),
      confidence: artifact.classification.confidence,
      reproEligible: artifact.repro_eligible,
      summary: artifact.summary,
      tokensUsed: args.tokensUsed,
      schemaVersion: artifact.schema_version,
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
    return await upsertReproContractDoc(ctx, args);
  },
});

export const storeReproContractFromAction = internalMutation({
  args: {
    runId: v.id("runs"),
    schemaVersion: reproContractSchemaVersionValidator,
    acceptance: acceptanceValidator,
    sandboxPolicy: sandboxPolicyValidator,
    budgets: budgetsValidator,
  },
  handler: async (ctx, args) => {
    return await upsertReproContractDoc(ctx, args);
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
    return await upsertReproPlanDoc(ctx, args);
  },
});

export const storeReproPlanFromAction = internalMutation({
  args: {
    runId: v.id("runs"),
    schemaVersion: reproPlanSchemaVersionValidator,
    baseRevision: baseRevisionValidator,
    environmentStrategy: environmentStrategyValidator,
    commands: v.array(planCommandValidator),
    artifact: plannedArtifactValidator,
  },
  handler: async (ctx, args) => {
    return await upsertReproPlanDoc(ctx, args);
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
    failureType: v.optional(reproRunFailureTypeValidator),
    environmentStrategy: v.optional(reproRunEnvironmentStrategyValidator),
    artifactContent: v.optional(v.string()),
    logStorageId: v.optional(v.id("_storage")),
    durationMs: v.int64(),
  },
  handler: async (ctx, args) => {
    await requireRunAccess(ctx, args.runId);
    const reproRunId = await upsertReproRunDoc(ctx, args);
    await syncRunLatestReproRun(ctx, args.runId);
    return reproRunId;
  },
});

export const storeReproRunFromAction = internalMutation({
  args: {
    runId: v.id("runs"),
    schemaVersion: reproRunSchemaVersionValidator,
    iteration: v.int64(),
    sandbox: sandboxValidator,
    steps: v.array(stepResultValidator),
    failureObserved: v.optional(failureObservedValidator),
    failureType: v.optional(reproRunFailureTypeValidator),
    environmentStrategy: v.optional(reproRunEnvironmentStrategyValidator),
    artifactContent: v.optional(v.string()),
    logStorageId: v.optional(v.id("_storage")),
    durationMs: v.int64(),
  },
  handler: async (ctx, args) => {
    const reproRunId = await upsertReproRunDoc(ctx, args);
    await syncRunLatestReproRun(ctx, args.runId);
    return reproRunId;
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
    return await upsertVerificationDoc(ctx, args, { patchRunStatus: true });
  },
});

export const storeVerificationFromAction = internalMutation({
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
    return await upsertVerificationDoc(ctx, args, { patchRunStatus: false });
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

    const [triage, contract, plan, reproRuns, verification, issue] =
      await Promise.all([
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
