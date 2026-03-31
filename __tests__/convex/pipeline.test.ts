import { beforeEach, describe, expect, it, vi } from "vitest";

const anthropicState = vi.hoisted(() => {
  class MockAPIError extends Error {
    status?: number;

    constructor(status: number, message: string) {
      super(message);
      this.name = "MockAPIError";
      this.status = status;
    }
  }

  class MockRateLimitError extends MockAPIError {
    constructor(message = "Rate limited") {
      super(429, message);
      this.name = "MockRateLimitError";
    }
  }

  class MockAPIConnectionError extends Error {
    constructor(message = "Connection failed") {
      super(message);
      this.name = "MockAPIConnectionError";
    }
  }

  return {
    create: vi.fn(),
    getRequestOptions: vi.fn(),
    provider: "anthropic" as "anthropic" | "openrouter",
    MockAPIError,
    MockRateLimitError,
    MockAPIConnectionError,
  };
});

const sandboxState = vi.hoisted(() => ({
  execute: vi.fn(),
}));

const githubState = vi.hoisted(() => ({
  getBranch: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => {
  return {
    APIError: anthropicState.MockAPIError,
    RateLimitError: anthropicState.MockRateLimitError,
    APIConnectionError: anthropicState.MockAPIConnectionError,
  };
});

vi.mock("@/lib/claude", () => {
  return {
    DEFAULT_MAX_TOKENS: 4096,
    MODELS: {
      triage: "claude-sonnet-4-20250514",
      reproduce: "claude-sonnet-4-20250514",
      verify: "claude-sonnet-4-20250514",
    },
    getLlmProvider: () => anthropicState.provider,
    getAnthropicClient: () => ({
      messages: {
        create: anthropicState.create,
      },
    }),
    getAnthropicRequestOptions: anthropicState.getRequestOptions,
  };
});

vi.mock("@/lib/sandbox-client", () => {
  return {
    executeSandbox: sandboxState.execute,
  };
});

vi.mock("@/lib/githubApp", () => {
  return {
    getInstallationOctokit: vi.fn(async () => ({
      rest: {
        repos: {
          getBranch: githubState.getBranch,
        },
      },
    })),
  };
});

import { internal } from "@/convex/_generated/api";
import { sampleTriageArtifacts } from "@/__tests__/fixtures/sample-triage";
import {
  createTestConvex,
  seedInstallation,
  seedIssue,
  seedRepo,
  seedRun,
  seedUser,
} from "@/test-support/convex/testHelpers";
import {
  buildReproPlanArtifact,
  buildReproRunArtifact,
  reproPlanArtifactToMutationArgs,
  reproRunArtifactToMutationArgs,
  type ReproArtifactToolOutput,
  type ReproPlanToolOutput,
} from "@/lib/repro-parser";
import {
  generateReproContract,
  reproContractArtifactToMutationArgs,
} from "@/lib/prompts/verifier";

function buildClaudeResponse({
  reproEligible = true,
  summary = "Parser crash is reproducible with a deterministic exception.",
}: {
  reproEligible?: boolean;
  summary?: string;
} = {}) {
  return {
    id: "msg_test_123",
    container: null,
    content: [
      { type: "text", text: "Submitting structured triage output." },
      {
        type: "tool_use",
        id: "toolu_test_123",
        name: "submit_triage",
        input: {
          classification: {
            type: "bug",
            area: ["parser"],
            severity: "high",
            labels_suggested: ["type:bug", "area:parser"],
            confidence: 0.92,
          },
          repro_hypothesis: {
            minimal_steps_guess: [
              "Create an empty YAML file.",
              "Run the parser against it.",
            ],
            expected_failure_signal: {
              kind: "exception",
              match_any: ["ParseError"],
            },
            environment_assumptions: {
              os: "Ubuntu 22.04",
              runtime: "Node 20.x",
            },
          },
          repro_eligible: reproEligible,
          summary,
        },
      },
    ],
    model: "claude-sonnet-4-20250514",
    role: "assistant",
    stop_reason: "end_turn",
    stop_sequence: null,
    type: "message",
    usage: {
      cache_creation: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      inference_geo: null,
      input_tokens: 321,
      output_tokens: 123,
      server_tool_use: null,
    },
  };
}

function buildReproPlanToolOutput(): ReproPlanToolOutput {
  return {
    base_revision: {
      ref: "refs/heads/main",
    },
    environment_strategy: {
      preferred: "dockerfile",
      notes: "Prefer the repository Dockerfile.",
    },
    commands: [
      {
        cmd: "npm ci",
      },
      {
        cwd: "tests",
        cmd: "npx vitest run repro-issue-42.test.ts",
      },
    ],
    artifact: {
      type: "vitest_test",
      path: "tests/repro-issue-42.test.ts",
      entrypoint: "repro-issue-42",
    },
  };
}

function buildReproArtifactToolOutput(
  overrides: Partial<ReproArtifactToolOutput> = {},
): ReproArtifactToolOutput {
  return {
    file_path: "tests/repro-issue-42.test.ts",
    content: [
      'import { describe, expect, it } from "vitest";',
      "",
      'describe("repro", () => {',
      '  it("fails on empty YAML", () => {',
      '    throw new Error("ParseError: unexpected end of input");',
      "  });",
      "});",
    ].join("\n"),
    language: "typescript",
    ...overrides,
  };
}

function buildReproClaudeResponse({
  plan = buildReproPlanToolOutput(),
  artifact = buildReproArtifactToolOutput(),
}: {
  plan?: ReproPlanToolOutput;
  artifact?: ReproArtifactToolOutput;
} = {}) {
  return {
    id: "msg_repro_123",
    container: null,
    content: [
      { type: "text", text: "Submitting reproduction artifacts." },
      {
        type: "tool_use",
        id: "toolu_repro_plan",
        name: "submit_repro_plan",
        input: plan,
      },
      {
        type: "tool_use",
        id: "toolu_repro_artifact",
        name: "submit_repro_artifact",
        input: artifact,
      },
    ],
    model: "claude-sonnet-4-20250514",
    role: "assistant",
    stop_reason: "end_turn",
    stop_sequence: null,
    type: "message",
    usage: {
      cache_creation: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      inference_geo: null,
      input_tokens: 512,
      output_tokens: 256,
      server_tool_use: null,
    },
  };
}

function buildSandboxResult(
  overrides: Partial<{
    status: "success" | "failure" | "error" | "timeout";
    exitCode: number;
    stderrTail: string;
    stdoutTail: string;
    failureType: "env_setup" | "repro_failure";
  }> = {},
) {
  const status = overrides.status ?? "failure";
  const exitCode = overrides.exitCode ?? (status === "timeout" ? 124 : 1);

  return {
    runId: "run_pipeline",
    status,
    ...(status === "success"
      ? {}
      : { failureType: overrides.failureType ?? "repro_failure" }),
    sandbox: {
      kind: "docker" as const,
      imageDigest: "sha256:abc123",
      network: "disabled" as const,
      uid: 1000,
    },
    steps: [
      {
        name: "run_test",
        cmd: "npx vitest run repro-issue-42.test.ts",
        exitCode,
        stdoutSha256: "a".repeat(64),
        stderrSha256: "b".repeat(64),
        durationMs: 1234,
        stdoutTail: overrides.stdoutTail ?? "",
        stderrTail:
          overrides.stderrTail ?? "ParseError: unexpected end of input",
      },
    ],
    ...(status === "success"
      ? {}
      : {
          failureObserved:
            status === "timeout"
              ? {
                  kind: "timeout" as const,
                  traceExcerptSha256: "c".repeat(64),
                }
              : {
                  kind: "exception" as const,
                  matchAny: ["ParseError"],
                  traceExcerptSha256: "c".repeat(64),
                },
        }),
    environmentStrategy: {
      preferred: "dockerfile" as const,
      detected: "dockerfile" as const,
      fallbacks: ["synth_dockerfile", "bootstrap"] as Array<
        "synth_dockerfile" | "bootstrap"
      >,
      notes: "Found Dockerfile at Dockerfile",
      attempted: "dockerfile" as const,
      imageUsed: "rb-sandbox:test",
    },
    totalDurationMs: 1234,
  };
}

function buildOpenRouterError({
  status,
  message,
  metadata,
}: {
  status: number;
  message: string;
  metadata?: Record<string, unknown>;
}): Error & {
  status: number;
  error: {
    code: number;
    message: string;
    metadata?: Record<string, unknown>;
  };
} {
  return Object.assign(new Error(message), {
    name: "OpenRouterError",
    status,
    error: {
      code: status,
      message,
      ...(metadata ? { metadata } : {}),
    },
  });
}

async function setupPipelineFixture() {
  const t = createTestConvex();
  const { userId } = await seedUser(t);
  const installationId = await seedInstallation(t, userId);
  const { repoId } = await seedRepo(t, { userId, installationId });
  const issueId = await seedIssue(t, repoId, {
    title: "Parser crash on empty YAML input",
    body: "Running the parser on an empty YAML file throws a ParseError.",
  });
  const runId = await seedRun(t, {
    userId,
    repoId,
    issueId,
    runId: "run_pipeline",
  });

  return { t, repoId, issueId, runId };
}

async function seedTriageResult(
  t: ReturnType<typeof createTestConvex>,
  runId: Awaited<ReturnType<typeof setupPipelineFixture>>["runId"],
) {
  await t.mutation(internal.artifacts.storeTriage, {
    runId,
    artifact: {
      ...sampleTriageArtifacts.typescriptVitestBug,
      run_id: "run_pipeline",
    },
    tokensUsed: {
      input: 111,
      output: 55,
    },
  });
}

beforeEach(() => {
  anthropicState.create.mockReset();
  anthropicState.getRequestOptions.mockReset();
  anthropicState.getRequestOptions.mockReturnValue(undefined);
  anthropicState.provider = "anthropic";
  sandboxState.execute.mockReset();
  githubState.getBranch.mockReset();
  githubState.getBranch.mockResolvedValue({
    data: {
      commit: {
        sha: "deadbee1234567890deadbee1234567890deadb",
      },
    },
  });
  vi.useRealTimers();
});

describe("pipeline.runTriage", () => {
  it("stores triage output and leaves repro-eligible runs awaiting approval", async () => {
    anthropicState.create.mockResolvedValue(buildClaudeResponse());
    const { t, runId, issueId } = await setupPipelineFixture();

    await t.action(internal.pipeline.runTriage, { runId, issueId });

    const { run, triage } = await t.run(async (ctx) => {
      return {
        run: await ctx.db.get(runId),
        triage: await ctx.db
          .query("triageResults")
          .withIndex("by_run", (q) => q.eq("runId", runId))
          .unique(),
      };
    });

    expect(anthropicState.create).toHaveBeenCalledTimes(1);
    expect(anthropicState.create.mock.calls[0]?.[0]?.messages[0]?.content).toContain(
      "Parser crash on empty YAML input",
    );
    expect(run).toMatchObject({
      status: "awaiting_approval",
      errorMessage:
        "No repo settings configured; defaulting to maintainer label approval",
    });
    expect(triage).toMatchObject({
      runId,
      reproEligible: true,
      summary: "Parser crash is reproducible with a deterministic exception.",
      tokensUsed: {
        input: 321,
        output: 123,
      },
    });
  });

  it("passes Anthropic SDK request options through to the triage request", async () => {
    const requestOptions = {
      body: {
        provider: {
          order: ["anthropic", "amazon-bedrock", "google-vertex"],
          allow_fallbacks: true,
        },
      },
    };
    anthropicState.getRequestOptions.mockReturnValueOnce(requestOptions);
    anthropicState.create.mockResolvedValue(buildClaudeResponse());
    const { t, runId, issueId } = await setupPipelineFixture();

    await t.action(internal.pipeline.runTriage, { runId, issueId });

    expect(anthropicState.getRequestOptions).toHaveBeenCalledTimes(1);
    expect(anthropicState.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
      }),
      requestOptions,
    );
  });

  it("completes runs when triage marks them as not repro eligible", async () => {
    anthropicState.create.mockResolvedValue(
      buildClaudeResponse({ reproEligible: false }),
    );
    const { t, runId, issueId } = await setupPipelineFixture();

    await t.action(internal.pipeline.runTriage, { runId, issueId });

    const run = await t.run(async (ctx) => await ctx.db.get(runId));

    expect(run).toMatchObject({
      status: "completed",
    });
    expect(run?.completedAt).toBeTypeOf("number");
  });

  it("fails the run when Claude returns no tool block", async () => {
    anthropicState.create.mockResolvedValue({
      ...buildClaudeResponse(),
      content: [{ type: "text", text: "No structured output." }],
    });
    const { t, runId, issueId } = await setupPipelineFixture();

    await t.action(internal.pipeline.runTriage, { runId, issueId });

    const run = await t.run(async (ctx) => await ctx.db.get(runId));

    expect(run).toMatchObject({
      status: "failed",
    });
    expect(run?.errorMessage).toContain("Claude did not return submit_triage");
  });

  it("retries rate limit errors with backoff before succeeding", async () => {
    vi.useFakeTimers();
    anthropicState.create
      .mockRejectedValueOnce(
        new anthropicState.MockRateLimitError("Slow down"),
      )
      .mockResolvedValueOnce(buildClaudeResponse());
    const { t, runId, issueId } = await setupPipelineFixture();

    const actionPromise = t.action(internal.pipeline.runTriage, { runId, issueId });
    await vi.runAllTimersAsync();
    await actionPromise;

    const run = await t.run(async (ctx) => await ctx.db.get(runId));

    expect(anthropicState.create).toHaveBeenCalledTimes(2);
    expect(run?.status).toBe("awaiting_approval");
  });

  it.each([500, 502, 503, 504])(
    "retries Claude API %s errors before succeeding",
    async (status) => {
      vi.useFakeTimers();
      anthropicState.create
        .mockRejectedValueOnce(
          new anthropicState.MockAPIError(status, `status ${status}`),
        )
        .mockResolvedValueOnce(buildClaudeResponse());
      const { t, runId, issueId } = await setupPipelineFixture();

      const actionPromise = t.action(internal.pipeline.runTriage, {
        runId,
        issueId,
      });
      await vi.runAllTimersAsync();
      await actionPromise;

      const run = await t.run(async (ctx) => await ctx.db.get(runId));

      expect(anthropicState.create).toHaveBeenCalledTimes(2);
      expect(run?.status).toBe("awaiting_approval");
    },
  );

  it("retries OpenRouter rate limit errors surfaced as generic error payloads", async () => {
    vi.useFakeTimers();
    anthropicState.provider = "openrouter";
    anthropicState.create
      .mockRejectedValueOnce(
        buildOpenRouterError({
          status: 429,
          message: "Rate limit exceeded",
          metadata: {
            provider_name: "anthropic",
          },
        }),
      )
      .mockResolvedValueOnce(buildClaudeResponse());
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { t, runId, issueId } = await setupPipelineFixture();

    const actionPromise = t.action(internal.pipeline.runTriage, { runId, issueId });
    await vi.runAllTimersAsync();
    await actionPromise;

    const run = await t.run(async (ctx) => await ctx.db.get(runId));

    expect(anthropicState.create).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[pipeline] Retrying triage request"),
      expect.objectContaining({
        llmProvider: "openrouter",
        providerName: "anthropic",
        retryable: true,
        status: 429,
      }),
    );
    expect(run?.status).toBe("awaiting_approval");

    warnSpy.mockRestore();
  });

  it("fails immediately when OpenRouter reports provider exhaustion", async () => {
    vi.useFakeTimers();
    anthropicState.provider = "openrouter";
    anthropicState.create
      .mockRejectedValueOnce(
        new anthropicState.MockAPIError(
          503,
          "No available model provider that meets your routing requirements",
        ),
      )
      .mockResolvedValueOnce(buildClaudeResponse());
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { t, runId, issueId } = await setupPipelineFixture();

    const actionPromise = t.action(internal.pipeline.runTriage, { runId, issueId });
    await vi.runAllTimersAsync();
    await actionPromise;

    const run = await t.run(async (ctx) => await ctx.db.get(runId));

    expect(anthropicState.create).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[pipeline] Triage failed"),
      expect.objectContaining({
        llmProvider: "openrouter",
        retryable: false,
        status: 503,
      }),
    );
    expect(run).toMatchObject({
      status: "failed",
    });

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("fails immediately for non-retryable errors", async () => {
    anthropicState.create.mockRejectedValueOnce(
      new anthropicState.MockAPIError(400, "Bad request"),
    );
    const { t, runId, issueId } = await setupPipelineFixture();

    await t.action(internal.pipeline.runTriage, { runId, issueId });

    const run = await t.run(async (ctx) => await ctx.db.get(runId));

    expect(anthropicState.create).toHaveBeenCalledTimes(1);
    expect(run).toMatchObject({
      status: "failed",
      errorMessage: "Claude API error (400): Bad request",
    });
  });
});

describe("pipeline.runReproduce", () => {
  it("refines after runtime feedback and completes when the expected failure appears", async () => {
    anthropicState.create
      .mockResolvedValueOnce(buildReproClaudeResponse())
      .mockResolvedValueOnce(
        buildReproClaudeResponse({
          artifact: buildReproArtifactToolOutput({
            content: [
              'import { describe, it } from "vitest";',
              "",
              'describe("repro", () => {',
              '  it("captures the parser crash", () => {',
              '    throw new Error("ParseError: unexpected end of input");',
              "  });",
              "});",
            ].join("\n"),
          }),
        }),
      );
    sandboxState.execute
      .mockResolvedValueOnce(
        buildSandboxResult({
          stderrTail: "ModuleNotFoundError: parser",
        }),
      )
      .mockResolvedValueOnce(
        buildSandboxResult({
          stderrTail: "ParseError: unexpected end of input",
        }),
      );
    const { t, runId } = await setupPipelineFixture();
    await seedTriageResult(t, runId);

    await t.action(internal.pipeline.runReproduce, { runId });

    const result = await t.run(async (ctx) => {
      return {
        run: await ctx.db.get(runId),
        contract: await ctx.db
          .query("reproContracts")
          .withIndex("by_run", (q) => q.eq("runId", runId))
          .unique(),
        plan: await ctx.db
          .query("reproPlans")
          .withIndex("by_run", (q) => q.eq("runId", runId))
          .unique(),
        reproRuns: await ctx.db
          .query("reproRuns")
          .withIndex("by_run", (q) => q.eq("runId", runId))
          .collect(),
      };
    });

    expect(githubState.getBranch).toHaveBeenCalledWith({
      owner: "repo-butler",
      repo: "example",
      branch: "main",
    });
    expect(anthropicState.create).toHaveBeenCalledTimes(2);
    expect(sandboxState.execute).toHaveBeenCalledTimes(2);
    expect(
      anthropicState.create.mock.calls[1]?.[0]?.messages[0]?.content,
    ).toContain("ModuleNotFoundError: parser");
    expect(
      anthropicState.create.mock.calls[1]?.[0]?.messages[0]?.content,
    ).toContain("Import error - missing module or incorrect path");
    expect(result.run).toMatchObject({
      status: "verifying",
    });
    expect(result.run?.verdict).toBeUndefined();
    expect(result.contract).toMatchObject({
      schemaVersion: "rb.repro_contract.v1",
      acceptance: {
        mustNotRequireNetwork: true,
      },
    });
    expect(result.plan).toMatchObject({
      schemaVersion: "rb.repro_plan.v1",
      baseRevision: {
        sha: "deadbee1234567890deadbee1234567890deadb",
      },
    });
    expect(result.reproRuns).toHaveLength(2);
    expect(result.reproRuns[0]?.iteration).toBe(BigInt(1));
    expect(result.reproRuns[1]?.iteration).toBe(BigInt(2));
  });

  it("marks the run as budget exhausted after six unsuccessful attempts", async () => {
    anthropicState.create.mockResolvedValue(buildReproClaudeResponse());
    sandboxState.execute.mockResolvedValue(
      buildSandboxResult({
        status: "success",
        exitCode: 0,
        stderrTail: "",
        stdoutTail: "tests passed",
      }),
    );
    const { t, runId } = await setupPipelineFixture();
    await seedTriageResult(t, runId);

    await t.action(internal.pipeline.runReproduce, { runId });

    const result = await t.run(async (ctx) => {
      return {
        run: await ctx.db.get(runId),
        reproRuns: await ctx.db
          .query("reproRuns")
          .withIndex("by_run", (q) => q.eq("runId", runId))
          .collect(),
      };
    });

    expect(anthropicState.create).toHaveBeenCalledTimes(6);
    expect(sandboxState.execute).toHaveBeenCalledTimes(6);
    expect(result.run).toMatchObject({
      status: "failed",
      verdict: "budget_exhausted",
      errorMessage: "Failed to reproduce after 6 iterations",
    });
    expect(result.reproRuns).toHaveLength(6);
  });
});

describe("pipeline.runVerify", () => {
  it("reruns the stored reproduction artifact and stores a reproduced verification", async () => {
    sandboxState.execute.mockResolvedValue(
      buildSandboxResult({
        stderrTail: "ParseError: unexpected end of input",
      }),
    );
    const { t, runId } = await setupPipelineFixture();
    await seedTriageResult(t, runId);

    const planArtifact = buildReproPlanArtifact({
      runId: "run_pipeline",
      toolOutput: buildReproPlanToolOutput(),
      defaultBaseRevision: {
        ref: "refs/heads/main",
        sha: "deadbee1234567890deadbee1234567890deadb",
      },
    });
    const reproRunArtifact = buildReproRunArtifact({
      runId: "run_pipeline",
      iteration: 1,
      sandboxResult: buildSandboxResult({
        stderrTail: "ParseError: unexpected end of input",
      }),
      artifactContent: buildReproArtifactToolOutput().content,
    });

    await t.mutation(
      internal.artifacts.storeReproContractFromAction,
      reproContractArtifactToMutationArgs(
        runId,
        generateReproContract(
          "run_pipeline",
          sampleTriageArtifacts.typescriptVitestBug,
        ),
      ),
    );
    await t.mutation(
      internal.artifacts.storeReproPlanFromAction,
      reproPlanArtifactToMutationArgs(runId, planArtifact),
    );
    await t.mutation(
      internal.artifacts.storeReproRunFromAction,
      reproRunArtifactToMutationArgs(runId, reproRunArtifact),
    );

    await t.action(internal.pipeline.runVerify, { runId });

    const result = await t.run(async (ctx) => {
      return {
        run: await ctx.db.get(runId),
        contract: await ctx.db
          .query("reproContracts")
          .withIndex("by_run", (q) => q.eq("runId", runId))
          .unique(),
        verification: await ctx.db
          .query("verifications")
          .withIndex("by_run", (q) => q.eq("runId", runId))
          .unique(),
      };
    });

    expect(sandboxState.execute.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(sandboxState.execute.mock.calls[0]?.[0]).toMatchObject({
      policy: {
        network: "disabled",
        runAsRoot: false,
        secretsMount: "none",
      },
    });
    expect(result.contract).toMatchObject({
      schemaVersion: "rb.repro_contract.v1",
    });
    expect(result.verification).toMatchObject({
      verdict: "reproduced",
      policyChecks: {
        networkUsed: false,
        secretsAccessed: false,
        writesOutsideWorkspace: false,
        ranAsRoot: false,
      },
    });
    expect(result.verification?.determinism).toMatchObject({
      reruns: BigInt(3),
      fails: BigInt(3),
      flakeRate: 0,
    });
    expect(result.run).toMatchObject({
      status: "completed",
      verdict: "reproduced",
    });
  });

  it("uses the stored repro contract instead of regenerating it during verification", async () => {
    sandboxState.execute.mockResolvedValue(
      buildSandboxResult({
        stderrTail: "ParseError: unexpected end of input",
      }),
    );
    const { t, runId } = await setupPipelineFixture();
    await seedTriageResult(t, runId);

    const contract = generateReproContract(
      "run_pipeline",
      sampleTriageArtifacts.typescriptVitestBug,
    );
    contract.acceptance.must_be_deterministic.reruns = 1;

    const planArtifact = buildReproPlanArtifact({
      runId: "run_pipeline",
      toolOutput: buildReproPlanToolOutput(),
      defaultBaseRevision: {
        ref: "refs/heads/main",
        sha: "deadbee1234567890deadbee1234567890deadb",
      },
    });
    const reproRunArtifact = buildReproRunArtifact({
      runId: "run_pipeline",
      iteration: 1,
      sandboxResult: buildSandboxResult(),
      artifactContent: buildReproArtifactToolOutput().content,
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

    await t.action(internal.pipeline.runVerify, { runId });

    const result = await t.run(async (ctx) => {
      return await ctx.db
        .query("reproContracts")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .unique();
    });

    expect(sandboxState.execute).toHaveBeenCalledTimes(1);
    expect(result?.acceptance.mustBeDeterministic.reruns).toBe(BigInt(1));
  });

  it("fails fast when the stored repro contract requests unsupported sandbox policy", async () => {
    const { t, runId } = await setupPipelineFixture();
    await seedTriageResult(t, runId);

    const contract = generateReproContract(
      "run_pipeline",
      sampleTriageArtifacts.typescriptVitestBug,
    );
    contract.sandbox_policy.secrets_mount = "readonly";

    const planArtifact = buildReproPlanArtifact({
      runId: "run_pipeline",
      toolOutput: buildReproPlanToolOutput(),
      defaultBaseRevision: {
        ref: "refs/heads/main",
        sha: "deadbee1234567890deadbee1234567890deadb",
      },
    });
    const reproRunArtifact = buildReproRunArtifact({
      runId: "run_pipeline",
      iteration: 1,
      sandboxResult: buildSandboxResult(),
      artifactContent: buildReproArtifactToolOutput().content,
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

    await t.action(internal.pipeline.runVerify, { runId });

    const result = await t.run(async (ctx) => {
      return await ctx.db.get(runId);
    });

    expect(sandboxState.execute).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "failed",
      errorMessage:
        "Verification sandbox does not support contracts with secrets_mount=readonly",
    });
  });
});
