import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { MAX_REPRODUCTION_ITERATIONS } from "../lib/prompts/reproducer";
import type { ReproContract } from "../lib/prompts/verifier";
import type { SandboxResult } from "../worker/types";

const dispatchStageValidator = v.union(
  v.literal("reproduce"),
  v.literal("verify"),
);

const environmentStrategyValidator = v.union(
  v.literal("devcontainer"),
  v.literal("dockerfile"),
  v.literal("synth_dockerfile"),
  v.literal("bootstrap"),
);

const commandValidator = v.object({
  name: v.string(),
  cmd: v.string(),
  cwd: v.optional(v.string()),
  timeout: v.optional(v.number()),
});

const storedDispatchInputValidator = v.object({
  targetRepo: v.string(),
  targetRef: v.string(),
  targetSha: v.string(),
  artifactPath: v.string(),
  artifactContent: v.string(),
  commands: v.array(commandValidator),
  callbackUrl: v.string(),
  policyNetwork: v.union(v.literal("disabled"), v.literal("enabled")),
  policyTimeout: v.number(),
  environmentStrategy: v.optional(environmentStrategyValidator),
  languageHint: v.optional(v.string()),
  runtimeHint: v.optional(v.string()),
  reruns: v.optional(v.number()),
  iteration: v.optional(v.number()),
});

type DispatchCallbackResult = {
  dispatch_id: string;
  run_id: string;
  stage: "reproduce" | "verify";
  workflow: string;
  status: "completed" | "failed";
  github_run_id?: number;
  github_run_attempt?: number;
  iteration?: number;
  sandbox_result?: SandboxResult;
  rerun_results?: SandboxResult[];
  error?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function findRelevantReproStep(
  result: SandboxResult,
  commandNames: string[],
) {
  const fallbackStep = result.steps[result.steps.length - 1];

  if (commandNames.length === 0) {
    return (
      [...result.steps].reverse().find((step) => step.exitCode !== 0) ??
      fallbackStep
    );
  }

  const failedByName = [...result.steps]
    .reverse()
    .find((step) => commandNames.includes(step.name) && step.exitCode !== 0);

  if (failedByName) {
    return failedByName;
  }

  return (
    [...result.steps].reverse().find((step) => commandNames.includes(step.name)) ??
    fallbackStep
  );
}

function matchesExpectedFailureSignal(
  result: SandboxResult,
  step:
    | SandboxResult["steps"][number]
    | undefined,
  signal: {
    kind: string;
    match_any?: string[];
  },
): boolean {
  if (signal.kind === "timeout") {
    return result.status === "timeout";
  }

  if (!step || step.exitCode === 0) {
    return false;
  }

  const patterns = signal.match_any ?? [];

  if (patterns.length === 0) {
    return true;
  }

  const haystack = `${step.stderrTail ?? ""}\n${step.stdoutTail ?? ""}`;
  return patterns.some((pattern) => haystack.includes(pattern));
}

function buildReproRunMutationArgs(input: {
  runId: Doc<"dispatches">["runId"];
  iteration: number;
  sandboxResult: SandboxResult;
  artifactContent: string;
}) {
  return {
    runId: input.runId,
    schemaVersion: "rb.repro_run.v1" as const,
    iteration: BigInt(input.iteration),
    sandbox: {
      kind: input.sandboxResult.sandbox.kind,
      ...(input.sandboxResult.sandbox.imageDigest
        ? { imageDigest: input.sandboxResult.sandbox.imageDigest }
        : {}),
      network: input.sandboxResult.sandbox.network,
      ...(typeof input.sandboxResult.sandbox.uid === "number"
        ? { uid: BigInt(input.sandboxResult.sandbox.uid) }
        : {}),
    },
    steps: input.sandboxResult.steps.map((step) => ({
      name: step.name,
      cmd: step.cmd,
      exitCode: BigInt(step.exitCode),
      ...(step.stdoutSha256 ? { stdoutSha256: step.stdoutSha256 } : {}),
      ...(step.stderrSha256 ? { stderrSha256: step.stderrSha256 } : {}),
      ...(step.stdoutTail ? { stdoutTail: step.stdoutTail } : {}),
      ...(step.stderrTail ? { stderrTail: step.stderrTail } : {}),
      ...(typeof step.durationMs === "number"
        ? { durationMs: BigInt(step.durationMs) }
        : {}),
    })),
    ...(input.sandboxResult.failureObserved
      ? {
          failureObserved: {
            kind: input.sandboxResult.failureObserved.kind,
            ...(input.sandboxResult.failureObserved.matchAny
              ? { matchAny: input.sandboxResult.failureObserved.matchAny }
              : {}),
            ...(input.sandboxResult.failureObserved.traceExcerptSha256
              ? {
                  traceExcerptSha256:
                    input.sandboxResult.failureObserved.traceExcerptSha256,
                }
              : {}),
          },
        }
      : {}),
    ...(input.sandboxResult.failureType
      ? { failureType: input.sandboxResult.failureType }
      : {}),
    ...(input.sandboxResult.environmentStrategy
      ? {
          environmentStrategy: {
            attempted:
              input.sandboxResult.environmentStrategy.attempted ??
              input.sandboxResult.environmentStrategy.detected ??
              input.sandboxResult.environmentStrategy.preferred,
            ...(input.sandboxResult.environmentStrategy.detected
              ? { detected: input.sandboxResult.environmentStrategy.detected }
              : {}),
            ...(input.sandboxResult.environmentStrategy.failedAt
              ? { failedAt: input.sandboxResult.environmentStrategy.failedAt }
              : {}),
            ...(input.sandboxResult.environmentStrategy.notes
              ? { notes: input.sandboxResult.environmentStrategy.notes }
              : {}),
            ...(input.sandboxResult.environmentStrategy.imageUsed
              ? { imageUsed: input.sandboxResult.environmentStrategy.imageUsed }
              : {}),
          },
        }
      : {}),
    artifactContent: input.artifactContent,
    durationMs: BigInt(input.sandboxResult.totalDurationMs),
  };
}

function findVerificationStep(result: SandboxResult) {
  const candidateSteps = result.steps.filter((step) => step.name !== "write_artifact");

  const namedTestStep = [...candidateSteps]
    .reverse()
    .find((step) => step.name === "run_test");

  if (namedTestStep) {
    return namedTestStep;
  }

  const frameworkStep = [...candidateSteps].reverse().find((step) =>
    /(pytest|vitest|jest|go test|npm test|pnpm test|yarn test)/.test(step.cmd),
  );

  if (frameworkStep) {
    return frameworkStep;
  }

  return (
    [...candidateSteps].reverse().find((step) => step.exitCode !== 0) ??
    candidateSteps[candidateSteps.length - 1] ??
    result.steps[result.steps.length - 1]
  );
}

function buildVerificationMutationArgs(input: {
  runId: Doc<"dispatches">["runId"];
  contract: ReproContract;
  rerunResults: SandboxResult[];
  reproArtifactPath: string;
}) {
  if (input.rerunResults.length === 0) {
    throw new Error("Verification requires at least one rerun result");
  }

  const buildEvidence = (
    result: SandboxResult,
    step: SandboxResult["steps"][number] | undefined,
  ) => ({
    failingCmd: step?.cmd ?? `artifact:${input.reproArtifactPath}`,
    exitCode: BigInt(step?.exitCode ?? (result.status === "timeout" ? 124 : 0)),
    ...(step?.stderrSha256 ? { stderrSha256: step.stderrSha256 } : {}),
  });

  const policyChecks = {
    networkUsed: input.rerunResults.some(
      (result) => result.sandbox.network === "enabled",
    ),
    secretsAccessed: false,
    writesOutsideWorkspace: false,
    ranAsRoot: input.rerunResults.some((result) => result.sandbox.uid === 0),
  };
  const fallbackResult = input.rerunResults[0];
  const fallbackStep = fallbackResult
    ? findVerificationStep(fallbackResult)
    : undefined;
  const fallbackEvidence = buildEvidence(fallbackResult, fallbackStep);
  const terminal = (
    verdict:
      | "reproduced"
      | "not_reproduced"
      | "flaky"
      | "policy_violation"
      | "env_setup_failed"
      | "budget_exhausted",
    notes: string,
    evidence = fallbackEvidence,
  ) => ({
    runId: input.runId,
    schemaVersion: "rb.verification.v1" as const,
    verdict,
    determinism: {
      reruns: BigInt(input.rerunResults.length),
      fails: BigInt(0),
      flakeRate: 1,
    },
    policyChecks,
    evidence,
    notes,
  });

  if (
    input.contract.acceptance.must_not_require_network &&
    policyChecks.networkUsed
  ) {
    return terminal(
      "policy_violation",
      "Network was enabled during verification despite a no-network contract.",
    );
  }

  if (!input.contract.sandbox_policy.run_as_root && policyChecks.ranAsRoot) {
    return terminal(
      "policy_violation",
      "Verification sandbox ran as root, violating the sandbox policy.",
    );
  }

  const envSetupResult = input.rerunResults.find(
    (result) => result.failureType === "env_setup",
  );

  if (envSetupResult) {
    return terminal(
      "env_setup_failed",
      "Verification could not complete because sandbox environment setup failed on at least one rerun.",
      buildEvidence(envSetupResult, findVerificationStep(envSetupResult)),
    );
  }

  if (input.contract.acceptance.failure_signal.kind !== "timeout") {
    const timeoutResult = input.rerunResults.find(
      (result) => result.status === "timeout",
    );

    if (timeoutResult) {
      return terminal(
        "budget_exhausted",
        "Verification timed out before reproducing the expected non-timeout failure signal.",
        buildEvidence(timeoutResult, findVerificationStep(timeoutResult)),
      );
    }
  }

  let failCount = 0;
  let lastEvidence = fallbackEvidence;

  for (const result of input.rerunResults) {
    const step = findVerificationStep(result);
    const patterns =
      input.contract.acceptance.failure_signal.stderr_match_any ?? [];
    const matches =
      input.contract.acceptance.failure_signal.kind === "timeout"
        ? result.status === "timeout"
        : !!step &&
          step.exitCode !== 0 &&
          (patterns.length === 0 ||
            patterns.some((pattern) =>
              `${step.stderrTail ?? ""}\n${step.stdoutTail ?? ""}`.includes(
                pattern,
              ),
            ));

    if (matches) {
      failCount += 1;
      lastEvidence = buildEvidence(result, step);
    }
  }

  const flakeRate = 1 - failCount / input.rerunResults.length;
  const allowedFlakeRate =
    input.contract.acceptance.must_be_deterministic.allowed_flake_rate;

  let verdict: "reproduced" | "not_reproduced" | "flaky";
  let notes: string;

  if (failCount === input.rerunResults.length) {
    verdict = "reproduced";
    notes = `Reproduction failed with the expected signal in ${failCount}/${input.rerunResults.length} reruns.`;
  } else if (failCount === 0) {
    verdict = "not_reproduced";
    notes = `Reproduction did not fail with the expected signal in any of ${input.rerunResults.length} reruns.`;
  } else if (flakeRate <= allowedFlakeRate) {
    verdict = "reproduced";
    notes = `Observed ${failCount}/${input.rerunResults.length} matching failures; flake rate ${(flakeRate * 100).toFixed(1)}% is within the allowed tolerance.`;
  } else {
    verdict = "flaky";
    notes = `Observed ${failCount}/${input.rerunResults.length} matching failures; flake rate ${(flakeRate * 100).toFixed(1)}% exceeds the allowed tolerance.`;
  }

  return {
    runId: input.runId,
    schemaVersion: "rb.verification.v1" as const,
    verdict,
    determinism: {
      reruns: BigInt(input.rerunResults.length),
      fails: BigInt(failCount),
      flakeRate,
    },
    policyChecks,
    evidence: lastEvidence,
    notes,
  };
}

function normalizeCallbackResult(
  value: unknown,
): DispatchCallbackResult {
  if (!isRecord(value)) {
    throw new Error("Invalid callback payload");
  }

  const dispatchId = readString(value.dispatch_id);
  const runId = readString(value.run_id);
  const stage = readString(value.stage);
  const workflow = readString(value.workflow);
  const status = readString(value.status);

  if (
    !dispatchId ||
    !runId ||
    (stage !== "reproduce" && stage !== "verify") ||
    !workflow ||
    (status !== "completed" && status !== "failed")
  ) {
    throw new Error("Invalid callback payload");
  }

  const iteration = readNumber(value.iteration);
  const githubRunId = readNumber(value.github_run_id);
  const githubRunAttempt = readNumber(value.github_run_attempt);
  const error = readString(value.error) ?? undefined;

  return {
    dispatch_id: dispatchId,
    run_id: runId,
    stage,
    workflow,
    status,
    ...(githubRunId !== undefined ? { github_run_id: githubRunId } : {}),
    ...(githubRunAttempt !== undefined
      ? { github_run_attempt: githubRunAttempt }
      : {}),
    ...(iteration !== undefined ? { iteration } : {}),
    ...(value.sandbox_result ? { sandbox_result: value.sandbox_result as SandboxResult } : {}),
    ...(Array.isArray(value.rerun_results)
      ? { rerun_results: value.rerun_results as SandboxResult[] }
      : {}),
    ...(error ? { error } : {}),
  };
}

export const recordDispatch = internalMutation({
  args: {
    runId: v.id("runs"),
    stage: dispatchStageValidator,
    workflowFile: v.string(),
    owner: v.string(),
    repo: v.string(),
    ref: v.string(),
    inputs: storedDispatchInputValidator,
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("dispatches", {
      ...args,
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

export const markDispatched = internalMutation({
  args: {
    dispatchId: v.id("dispatches"),
    actionsRunId: v.optional(v.number()),
    githubRunAttempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const dispatch = await ctx.db.get(args.dispatchId);

    if (!dispatch) {
      throw new Error("Dispatch not found");
    }

    await ctx.db.patch(args.dispatchId, {
      status: "dispatched",
      ...(args.actionsRunId !== undefined
        ? { actionsRunId: args.actionsRunId }
        : {}),
      ...(args.githubRunAttempt !== undefined
        ? { githubRunAttempt: args.githubRunAttempt }
        : {}),
    });
  },
});

export const markDispatchFailed = internalMutation({
  args: {
    dispatchId: v.id("dispatches"),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const dispatch = await ctx.db.get(args.dispatchId);

    if (!dispatch) {
      throw new Error("Dispatch not found");
    }

    await ctx.db.patch(args.dispatchId, {
      status: "failed",
      errorMessage: args.errorMessage,
      completedAt: Date.now(),
    });
  },
});

export const getById = internalQuery({
  args: {
    dispatchId: v.id("dispatches"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.dispatchId);
  },
});

export const handleCallback = internalMutation({
  args: {
    dispatchId: v.id("dispatches"),
    result: v.any(),
  },
  handler: async (ctx, args) => {
    const dispatch = await ctx.db.get(args.dispatchId);

    if (!dispatch) {
      throw new Error("Dispatch not found");
    }

    const run = await ctx.db.get(dispatch.runId);

    if (!run) {
      throw new Error("Run not found");
    }

    const result = normalizeCallbackResult(args.result);

    if (result.dispatch_id !== args.dispatchId) {
      throw new Error("Dispatch ID mismatch in callback payload");
    }

    if (result.run_id !== run.runId) {
      throw new Error("Run ID mismatch in callback payload");
    }

    if (result.stage !== dispatch.stage) {
      throw new Error("Dispatch stage mismatch in callback payload");
    }

    await ctx.db.patch(args.dispatchId, {
      status: result.status === "completed" ? "completed" : "failed",
      result: args.result,
      ...(result.github_run_id !== undefined
        ? { actionsRunId: result.github_run_id }
        : {}),
      ...(result.github_run_attempt !== undefined
        ? { githubRunAttempt: result.github_run_attempt }
        : {}),
      ...(result.error ? { errorMessage: result.error } : {}),
      completedAt: Date.now(),
    });

    if (result.stage === "reproduce") {
      if (result.status !== "completed" || !result.sandbox_result) {
        await ctx.runMutation(internal.runs.updateStatus, {
          runId: dispatch.runId,
          status: "failed",
          errorMessage:
            result.error ?? "GitHub Actions reproduction workflow failed",
        });
        return;
      }

      const iteration = dispatch.inputs.iteration ?? result.iteration ?? 1;
      await ctx.runMutation(
        internal.artifacts.storeReproRunFromAction,
        buildReproRunMutationArgs({
          runId: dispatch.runId,
          iteration,
          sandboxResult: result.sandbox_result,
          artifactContent: dispatch.inputs.artifactContent,
        }),
      );

      const triageResult = await ctx.runQuery(
        internal.triageResults.getInternalByRunId,
        {
          runId: dispatch.runId,
        },
      );

      if (!triageResult?.artifact) {
        throw new Error(`No triage artifact stored for run ${dispatch.runId}`);
      }

      const relevantStep = findRelevantReproStep(
        result.sandbox_result,
        dispatch.inputs.commands.map((command) => command.name),
      );

      if (
        matchesExpectedFailureSignal(
          result.sandbox_result,
          relevantStep,
          triageResult.artifact.repro_hypothesis.expected_failure_signal,
        )
      ) {
        await ctx.runMutation(internal.runs.updateStatus, {
          runId: dispatch.runId,
          status: "verifying",
        });
        await ctx.scheduler.runAfter(0, internal.pipeline.runVerify, {
          runId: dispatch.runId,
        });
        return;
      }

      if (iteration >= MAX_REPRODUCTION_ITERATIONS) {
        await ctx.runMutation(internal.runs.updateStatus, {
          runId: dispatch.runId,
          status: "failed",
          verdict:
            result.sandbox_result.failureType === "env_setup"
              ? "env_setup_failed"
              : "budget_exhausted",
          errorMessage: `Failed to reproduce after ${MAX_REPRODUCTION_ITERATIONS} iterations`,
        });
        return;
      }

      await ctx.scheduler.runAfter(0, internal.pipeline.runReproduce, {
        runId: dispatch.runId,
        iteration: iteration + 1,
      });
      return;
    }

    if (result.status !== "completed" || !result.rerun_results) {
      await ctx.runMutation(internal.runs.updateStatus, {
        runId: dispatch.runId,
        status: "failed",
        errorMessage:
          result.error ?? "GitHub Actions verification workflow failed",
      });
      return;
    }

    const [contract, reproRun] = await Promise.all([
      ctx.runQuery(internal.reproContracts.getInternalByRunId, {
        runId: dispatch.runId,
      }),
      ctx.runQuery(internal.reproRuns.getInternalByRunId, {
        runId: dispatch.runId,
      }),
    ]);

    if (!contract || !reproRun?.artifactContent) {
      throw new Error(
        `Missing repro contract or artifact content for verification of run ${dispatch.runId}`,
      );
    }

    const verification = buildVerificationMutationArgs({
      runId: dispatch.runId,
      contract,
      rerunResults: result.rerun_results,
      reproArtifactPath: dispatch.inputs.artifactPath,
    });

    await ctx.runMutation(
      internal.artifacts.storeVerificationFromAction,
      verification,
    );
    await ctx.runMutation(internal.runs.updateStatus, {
      runId: dispatch.runId,
      status: "reporting",
      verdict: verification.verdict,
    });
    await ctx.scheduler.runAfter(0, internal.pipeline.runReport, {
      runId: dispatch.runId,
    });
  },
});
