import fs from "node:fs/promises";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const githubState = vi.hoisted(() => ({
  createWorkflowDispatch: vi.fn(),
  getWorkflowRun: vi.fn(),
}));

vi.mock("@/lib/githubApp", () => {
  return {
    getInstallationOctokit: vi.fn(async () => ({
      rest: {
        actions: {
          createWorkflowDispatch: githubState.createWorkflowDispatch,
          getWorkflowRun: githubState.getWorkflowRun,
        },
      },
    })),
  };
});

import { internal } from "@/convex/_generated/api";
import {
  REPRODUCE_WORKFLOW_FILE,
  VERIFY_WORKFLOW_FILE,
  buildActionsCallbackSignature,
  buildWorkflowDispatchInputs,
  deriveActionsCallbackSecret,
  dispatchWorkflow,
  verifyActionsCallbackSignature,
} from "@/lib/actions-dispatcher";
import {
  buildReproPlanArtifact,
  buildReproRunArtifact,
  reproPlanArtifactToMutationArgs,
  reproRunArtifactToMutationArgs,
} from "@/lib/repro-parser";
import {
  generateReproContract,
  reproContractArtifactToMutationArgs,
} from "@/lib/prompts/verifier";
import {
  createTestConvex,
  seedInstallation,
  seedIssue,
  seedRepo,
  seedRun,
  seedUser,
} from "@/test-support/convex/testHelpers";
import { sampleTriageArtifacts } from "@/__tests__/fixtures/sample-triage";
import type { SandboxResult } from "@/worker/types";

function buildSandboxResult(
  overrides: Partial<SandboxResult> & {
    stderrTail?: string;
    stdoutTail?: string;
    exitCode?: number;
  } = {},
): SandboxResult {
  const exitCode = overrides.exitCode ?? 1;
  const stderrTail =
    overrides.stderrTail ?? "ParseError: unexpected end of input";
  const stdoutTail = overrides.stdoutTail ?? "";

  return {
    runId: overrides.runId ?? "run_dispatcher_fixture",
    status: overrides.status ?? (exitCode === 0 ? "success" : "failure"),
    sandbox: {
      kind: "docker",
      imageDigest:
        overrides.sandbox?.imageDigest ?? "sha256:deadbeefdeadbeefdeadbeef",
      network: overrides.sandbox?.network ?? "disabled",
      uid: overrides.sandbox?.uid ?? 1000,
    },
    steps: overrides.steps ?? [
      {
        name: "run_test",
        cmd: "pnpm test",
        exitCode,
        stdoutSha256: "a".repeat(64),
        stderrSha256: "b".repeat(64),
        durationMs: 1234,
        stdoutTail,
        stderrTail,
      },
    ],
    ...(overrides.failureType ? { failureType: overrides.failureType } : {}),
    ...(overrides.failureObserved
      ? { failureObserved: overrides.failureObserved }
      : {
          failureObserved:
            exitCode === 0
              ? undefined
              : {
                  kind: "exception",
                  matchAny: ["ParseError"],
                },
        }),
    totalDurationMs: overrides.totalDurationMs ?? 1234,
  };
}

async function setupRunFixture(runIdentifier = "run_dispatcher_fixture") {
  const t = createTestConvex();
  const { userId } = await seedUser(t);
  const installationId = await seedInstallation(t, userId);
  const { repoId } = await seedRepo(t, { userId, installationId });
  const issueId = await seedIssue(t, repoId);
  const runId = await seedRun(t, {
    userId,
    repoId,
    issueId,
    runId: runIdentifier,
    status: "reproducing",
  });

  return {
    t,
    userId,
    installationId,
    repoId,
    issueId,
    runId,
    runIdentifier,
  };
}

beforeEach(() => {
  githubState.createWorkflowDispatch.mockReset();
  githubState.getWorkflowRun.mockReset();
  vi.unstubAllEnvs();
});

describe("actions dispatcher helpers", () => {
  it("dispatches the requested workflow with stringified inputs", async () => {
    await dispatchWorkflow({
      installationId: 77,
      owner: "repo-butler",
      repo: "example",
      workflowFile: REPRODUCE_WORKFLOW_FILE,
      ref: "main",
      inputs: {
        dispatch_id: "dispatch_123",
        run_id: "run_123",
        target_repo: "repo-butler/example",
        target_ref: "main",
        target_sha: "deadbeef",
        artifact_path: "tests/repro.spec.ts",
        artifact_content_b64: "Y29udGVudA==",
        commands_json: '[{"name":"run_test","cmd":"pnpm test"}]',
        callback_url: "https://example.convex.site/actions/callback",
        callback_secret: "secret",
        policy_network: "disabled",
        policy_timeout: "1200",
      },
    });

    expect(githubState.createWorkflowDispatch).toHaveBeenCalledWith({
      owner: "repo-butler",
      repo: "example",
      workflow_id: REPRODUCE_WORKFLOW_FILE,
      ref: "main",
      inputs: expect.objectContaining({
        dispatch_id: "dispatch_123",
        run_id: "run_123",
      }),
    });
  });

  it("derives callback secrets, verifies signatures, and rejects tampering", async () => {
    vi.stubEnv("ACTIONS_CALLBACK_SECRET", "callback-secret-1234567890");

    const body = JSON.stringify({
      dispatch_id: "dispatch_abc",
      run_id: "run_abc",
      stage: "reproduce",
      workflow: REPRODUCE_WORKFLOW_FILE,
      status: "completed",
    });
    const rawBody = new TextEncoder().encode(body);
    const callbackSecret = await deriveActionsCallbackSecret("dispatch_abc");
    const signature = await buildActionsCallbackSignature(body, callbackSecret);

    await expect(
      verifyActionsCallbackSignature({
        rawBody,
        signature,
        dispatchId: "dispatch_abc",
      }),
    ).resolves.toBe(true);

    await expect(
      verifyActionsCallbackSignature({
        rawBody: new TextEncoder().encode(body.replace("completed", "failed")),
        signature,
        dispatchId: "dispatch_abc",
      }),
    ).resolves.toBe(false);
  });

  it("builds workflow inputs with base64 artifact content and timeout strings", async () => {
    vi.stubEnv("ACTIONS_CALLBACK_SECRET", "callback-secret-1234567890");

    const inputs = await buildWorkflowDispatchInputs({
      dispatchId: "dispatch_123",
      runId: "run_123",
      stored: {
        targetRepo: "repo-butler/example",
        targetRef: "main",
        targetSha: "deadbeef",
        artifactPath: "tests/repro.spec.ts",
        artifactContent: "console.log('hello');\n",
        commands: [{ name: "run_test", cmd: "pnpm test" }],
        callbackUrl: "https://example.convex.site/actions/callback",
        policyNetwork: "disabled",
        policyTimeout: 900,
        iteration: 2,
      },
    });

    expect(
      Buffer.from(inputs.artifact_content_b64, "base64").toString("utf8"),
    ).toBe("console.log('hello');\n");
    expect(inputs.commands_json).toBe(
      '[{"name":"run_test","cmd":"pnpm test"}]',
    );
    expect(inputs.policy_timeout).toBe("900");
    expect(inputs.iteration).toBe("2");
  });
});

describe("workflow files", () => {
  it("keep read-only permissions and map workflow inputs into the Actions entrypoint environment", async () => {
    const reproduceWorkflow = await fs.readFile(
      path.join(process.cwd(), ".github/workflows/repo-butler-reproduce.yml"),
      "utf8",
    );
    const verifyWorkflow = await fs.readFile(
      path.join(process.cwd(), ".github/workflows/repo-butler-verify.yml"),
      "utf8",
    );

    expect(reproduceWorkflow).toContain("contents: read");
    expect(verifyWorkflow).toContain("contents: read");
    expect(reproduceWorkflow).toContain(
      "pnpm exec tsx worker/actions-entrypoint.ts reproduce",
    );
    expect(verifyWorkflow).toContain(
      "pnpm exec tsx worker/actions-entrypoint.ts verify",
    );
    expect(reproduceWorkflow).toContain(
      "INPUT_DISPATCH_ID: ${{ inputs.dispatch_id }}",
    );
    expect(reproduceWorkflow).toContain(
      "INPUT_ITERATION: ${{ inputs.iteration }}",
    );
    expect(verifyWorkflow).toContain("INPUT_RERUNS: ${{ inputs.reruns }}");
    expect(reproduceWorkflow).toContain('default: "1200"');
    expect(verifyWorkflow).toContain('default: "1200"');
  });
});

describe("dispatcher.handleCallback", () => {
  it("stores reproduction results and advances the run to verifying", async () => {
    const { t, runId, runIdentifier } =
      await setupRunFixture("run_dispatch_repro");

    await t.mutation(internal.artifacts.storeTriage, {
      runId,
      artifact: {
        ...sampleTriageArtifacts.typescriptVitestBug,
        run_id: runIdentifier,
      },
      tokensUsed: {
        input: 1,
        output: 1,
      },
    });

    const dispatchId = await t.mutation(internal.dispatcher.recordDispatch, {
      runId,
      stage: "reproduce",
      workflowFile: REPRODUCE_WORKFLOW_FILE,
      owner: "repo-butler",
      repo: "example",
      ref: "main",
      inputs: {
        targetRepo: "repo-butler/example",
        targetRef: "main",
        targetSha: "deadbeef",
        artifactPath: "tests/repro.spec.ts",
        artifactContent: "failing repro body",
        commands: [{ name: "run_test", cmd: "pnpm test" }],
        callbackUrl: "https://example.convex.site/actions/callback",
        policyNetwork: "disabled",
        policyTimeout: 1200,
        iteration: 1,
      },
    });

    await t.mutation(internal.dispatcher.handleCallback, {
      dispatchId,
      result: {
        dispatch_id: dispatchId,
        run_id: runIdentifier,
        stage: "reproduce",
        workflow: REPRODUCE_WORKFLOW_FILE,
        status: "completed",
        iteration: 1,
        sandbox_result: buildSandboxResult(),
      },
    });

    const result = await t.run(async (ctx) => {
      return {
        run: await ctx.db.get(runId),
        dispatch: await ctx.db.get(dispatchId),
        reproRuns: await ctx.db
          .query("reproRuns")
          .withIndex("by_run", (q) => q.eq("runId", runId))
          .collect(),
      };
    });

    expect(result.dispatch).toMatchObject({
      status: "completed",
    });
    expect(result.reproRuns).toHaveLength(1);
    expect(result.reproRuns[0]).toMatchObject({
      iteration: BigInt(1),
      artifactContent: "failing repro body",
    });
    expect(result.run).toMatchObject({
      status: "verifying",
    });
  });

  it("stores verification results and advances the run to reporting", async () => {
    const { t, runId, runIdentifier } = await setupRunFixture(
      "run_dispatch_verify",
    );

    await t.mutation(internal.artifacts.storeTriage, {
      runId,
      artifact: {
        ...sampleTriageArtifacts.typescriptVitestBug,
        run_id: runIdentifier,
      },
      tokensUsed: {
        input: 1,
        output: 1,
      },
    });

    const contract = generateReproContract(
      runIdentifier,
      sampleTriageArtifacts.typescriptVitestBug,
    );
    const planArtifact = buildReproPlanArtifact({
      runId: runIdentifier,
      toolOutput: {
        base_revision: {
          ref: "refs/heads/main",
          sha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        },
        environment_strategy: {
          preferred: "dockerfile",
        },
        commands: [{ cmd: "pnpm test" }],
        artifact: {
          type: "vitest_test",
          path: "tests/repro.spec.ts",
        },
      },
      defaultBaseRevision: {
        ref: "refs/heads/main",
        sha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      },
    });
    const reproRunArtifact = buildReproRunArtifact({
      runId: runIdentifier,
      iteration: 1,
      sandboxResult: buildSandboxResult(),
      artifactContent: "failing repro body",
    });

    await t.mutation(
      internal.artifacts.storeReproContractFromAction,
      reproContractArtifactToMutationArgs(runId, contract),
    );
    await t.mutation(
      internal.artifacts.storeReproPlanFromAction,
      reproPlanArtifactToMutationArgs(runId, planArtifact),
    );
    await t.mutation(
      internal.artifacts.storeReproRunFromAction,
      reproRunArtifactToMutationArgs(runId, reproRunArtifact),
    );
    await t.mutation(internal.runs.updateStatus, {
      runId,
      status: "verifying",
    });

    const dispatchId = await t.mutation(internal.dispatcher.recordDispatch, {
      runId,
      stage: "verify",
      workflowFile: VERIFY_WORKFLOW_FILE,
      owner: "repo-butler",
      repo: "example",
      ref: "main",
      inputs: {
        targetRepo: "repo-butler/example",
        targetRef: "main",
        targetSha: "deadbeef",
        artifactPath: "tests/repro.spec.ts",
        artifactContent: "failing repro body",
        commands: [{ name: "run_test", cmd: "pnpm test" }],
        callbackUrl: "https://example.convex.site/actions/callback",
        policyNetwork: "disabled",
        policyTimeout: 1200,
        reruns: 3,
      },
    });

    await t.mutation(internal.dispatcher.handleCallback, {
      dispatchId,
      result: {
        dispatch_id: dispatchId,
        run_id: runIdentifier,
        stage: "verify",
        workflow: VERIFY_WORKFLOW_FILE,
        status: "completed",
        rerun_results: [
          buildSandboxResult(),
          buildSandboxResult(),
          buildSandboxResult(),
        ],
      },
    });

    const result = await t.run(async (ctx) => {
      return {
        run: await ctx.db.get(runId),
        dispatch: await ctx.db.get(dispatchId),
        verification: await ctx.db
          .query("verifications")
          .withIndex("by_run", (q) => q.eq("runId", runId))
          .unique(),
      };
    });

    expect(result.dispatch).toMatchObject({
      status: "completed",
    });
    expect(result.verification).toMatchObject({
      verdict: "reproduced",
    });
    expect(result.run).toMatchObject({
      status: "reporting",
      verdict: "reproduced",
    });
  });

  it("ignores duplicate callbacks after a dispatch has already completed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-31T19:00:00.000Z"));

    try {
      const { t, runId, runIdentifier } = await setupRunFixture(
        "run_dispatch_duplicate_callback",
      );

      await t.mutation(internal.artifacts.storeTriage, {
        runId,
        artifact: {
          ...sampleTriageArtifacts.typescriptVitestBug,
          run_id: runIdentifier,
        },
        tokensUsed: {
          input: 1,
          output: 1,
        },
      });

      const dispatchId = await t.mutation(internal.dispatcher.recordDispatch, {
        runId,
        stage: "reproduce",
        workflowFile: REPRODUCE_WORKFLOW_FILE,
        owner: "repo-butler",
        repo: "example",
        ref: "main",
        inputs: {
          targetRepo: "repo-butler/example",
          targetRef: "main",
          targetSha: "deadbeef",
          artifactPath: "tests/repro.spec.ts",
          artifactContent: "failing repro body",
          commands: [{ name: "run_test", cmd: "pnpm test" }],
          callbackUrl: "https://example.convex.site/actions/callback",
          policyNetwork: "disabled",
          policyTimeout: 1200,
          iteration: 1,
        },
      });

      const callbackResult = {
        dispatch_id: dispatchId,
        run_id: runIdentifier,
        stage: "reproduce" as const,
        workflow: REPRODUCE_WORKFLOW_FILE,
        status: "completed" as const,
        iteration: 1,
        sandbox_result: buildSandboxResult(),
      };

      await t.mutation(internal.dispatcher.handleCallback, {
        dispatchId,
        result: callbackResult,
      });

      const firstDispatch = await t.run(
        async (ctx) => await ctx.db.get(dispatchId),
      );
      vi.setSystemTime(new Date("2026-03-31T19:00:05.000Z"));

      await t.mutation(internal.dispatcher.handleCallback, {
        dispatchId,
        result: callbackResult,
      });

      const result = await t.run(async (ctx) => {
        return {
          dispatch: await ctx.db.get(dispatchId),
          reproRuns: await ctx.db
            .query("reproRuns")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .collect(),
        };
      });

      expect(firstDispatch?.completedAt).toBeDefined();
      expect(result.dispatch?.completedAt).toBe(firstDispatch?.completedAt);
      expect(result.dispatch?.result).toEqual(callbackResult);
      expect(result.reproRuns).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails malformed signed callback payloads without rethrowing", async () => {
    const { t, runId, runIdentifier } = await setupRunFixture(
      "run_dispatch_invalid_payload",
    );

    const dispatchId = await t.mutation(internal.dispatcher.recordDispatch, {
      runId,
      stage: "reproduce",
      workflowFile: REPRODUCE_WORKFLOW_FILE,
      owner: "repo-butler",
      repo: "example",
      ref: "main",
      inputs: {
        targetRepo: "repo-butler/example",
        targetRef: "main",
        targetSha: "deadbeef",
        artifactPath: "tests/repro.spec.ts",
        artifactContent: "failing repro body",
        commands: [{ name: "run_test", cmd: "pnpm test" }],
        callbackUrl: "https://example.convex.site/actions/callback",
        policyNetwork: "disabled",
        policyTimeout: 1200,
        iteration: 1,
      },
    });

    await expect(
      t.mutation(internal.dispatcher.handleCallback, {
        dispatchId,
        result: {
          dispatch_id: dispatchId,
          run_id: runIdentifier,
          stage: "reproduce",
          workflow: REPRODUCE_WORKFLOW_FILE,
          status: "completed",
          sandbox_result: {
            runId: runIdentifier,
            status: "failure",
          },
        },
      }),
    ).resolves.toBeNull();

    const result = await t.run(async (ctx) => {
      return {
        run: await ctx.db.get(runId),
        dispatch: await ctx.db.get(dispatchId),
      };
    });

    expect(result.dispatch).toMatchObject({
      status: "failed",
      errorMessage: "Invalid sandbox_result payload",
    });
    expect(result.run).toMatchObject({
      status: "failed",
      errorMessage: "Invalid sandbox_result payload",
    });
  });
});
