"use node";

import {
  APIConnectionError,
  APIError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { internalAction, type ActionCtx } from "./_generated/server";
import {
  DEFAULT_MAX_TOKENS,
  MODELS,
  getAnthropicClient,
  getAnthropicRequestOptions,
  getLlmProvider,
  type LlmProvider,
  type TriageInput,
} from "../lib/claude";
import { getInstallationOctokit } from "../lib/githubApp";
import {
  TRIAGE_SYSTEM_PROMPT,
  TRIAGE_TOOL_DEFINITION,
  TRIAGE_TOOL_NAME,
  buildTriageUserPrompt,
} from "../lib/prompts/triage";
import {
  MAX_REPRODUCTION_ITERATIONS,
  REPRO_ARTIFACT_TOOL_DEFINITION,
  REPRO_ARTIFACT_TOOL_NAME,
  REPRODUCER_SYSTEM_PROMPT,
  REPRO_PLAN_TOOL_DEFINITION,
  REPRO_PLAN_TOOL_NAME,
  buildReproducerUserPrompt,
} from "../lib/prompts/reproducer";
import {
  buildTriageArtifact,
  extractTriageFromResponse,
  validateTriageArtifact,
} from "../lib/triage-parser";
import {
  buildArtifactWriteCommand,
  buildReproPlanArtifact,
  buildReproRunArtifact,
  buildReproducerFeedback,
  extractReproArtifactFromResponse,
  extractReproPlanFromResponse,
  findRelevantReproStep,
  matchesExpectedFailureSignal,
  reproPlanArtifactToMutationArgs,
  reproRunArtifactToMutationArgs,
  validateReproPlanArtifact,
  validateReproRunArtifact,
} from "../lib/repro-parser";
import {
  generateReproContract,
  reproContractArtifactToMutationArgs,
  validateReproContractArtifact,
} from "../lib/prompts/verifier";
import { executeSandbox } from "../lib/sandbox-client";
import {
  validateVerificationArtifact,
  verificationArtifactToMutationArgs,
  verifyReproduction,
} from "../lib/verification";
import { normalizeStrategy } from "../worker/env-strategy";

const RETRY_DELAYS_MS = [1000, 3000, 5000] as const;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

type RetryDecision = {
  llmProvider: LlmProvider;
  status?: number;
  code?: number | string;
  message: string;
  providerName?: string;
  exhaustedProviders: boolean;
  retryable: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readCode(value: unknown): number | string | undefined {
  return typeof value === "number" || typeof value === "string" ? value : undefined;
}

function getErrorPayload(
  error: unknown,
  llmProvider: LlmProvider,
): Record<string, unknown> | undefined {
  const rawPayload =
    error instanceof APIError && isRecord(error.error)
      ? error.error
      : isRecord(error) && isRecord(error.error)
        ? error.error
        : undefined;

  if (!rawPayload) {
    return undefined;
  }

  if (llmProvider === "openrouter") {
    if (isRecord(rawPayload.error)) {
      return rawPayload.error;
    }

    if (isRecord(rawPayload.response) && isRecord(rawPayload.response.error)) {
      return rawPayload.response.error;
    }
  }

  return rawPayload;
}

function getProviderName(
  error: unknown,
  payload: Record<string, unknown> | undefined,
): string | undefined {
  if (payload && isRecord(payload.metadata)) {
    const providerName = readString(payload.metadata.provider_name);

    if (providerName) {
      return providerName;
    }
  }

  if (isRecord(error)) {
    return readString(error.provider);
  }

  return undefined;
}

function getRetryDecision(
  error: unknown,
  llmProvider: LlmProvider,
): RetryDecision {
  const payload = getErrorPayload(error, llmProvider);
  const status =
    error instanceof APIError && error.status !== undefined
      ? error.status
      : isRecord(error) && typeof error.status === "number"
        ? error.status
        : isRecord(error) && typeof error.statusCode === "number"
          ? error.statusCode
          : typeof payload?.code === "number"
            ? payload.code
            : undefined;
  const code = readCode(payload?.code);
  const message =
    readString(payload?.message) ??
    (error instanceof Error ? error.message : undefined) ??
    "Unknown triage error";
  const lowerMessage = message.toLowerCase();
  const lowerCode = typeof code === "string" ? code.toLowerCase() : undefined;
  const exhaustedProviders =
    llmProvider === "openrouter" &&
    (status === 503 ||
      code === 503 ||
      lowerMessage.includes("all providers exhausted") ||
      lowerMessage.includes("no available model provider"));
  const retryable =
    error instanceof APIConnectionError ||
    error instanceof RateLimitError ||
    (llmProvider === "openrouter"
      ? !exhaustedProviders &&
        ((status !== undefined && RETRYABLE_STATUSES.has(status)) ||
          status === 429 ||
          code === 429 ||
          lowerCode === "rate_limit_exceeded" ||
          lowerMessage.includes("rate limit"))
      : error instanceof APIError && RETRYABLE_STATUSES.has(status ?? 0));

  return {
    llmProvider,
    status,
    code,
    message,
    providerName: getProviderName(error, payload),
    exhaustedProviders,
    retryable,
  };
}

function formatErrorMessage(error: unknown, decision: RetryDecision): string {
  if (decision.llmProvider === "anthropic") {
    if (error instanceof APIError && error.status !== undefined) {
      return `Claude API error (${error.status}): ${error.message}`;
    }

    if (error instanceof Error) {
      return error.message;
    }

    return "Unknown triage error";
  }

  if (decision.status !== undefined) {
    return `OpenRouter API error (${decision.status}): ${decision.message}`;
  }

  if (decision.message) {
    return `OpenRouter error: ${decision.message}`;
  }

  return "Unknown triage error";
}

function buildLogContext(decision: RetryDecision): Record<string, unknown> {
  return {
    llmProvider: decision.llmProvider,
    status: decision.status,
    code: decision.code,
    providerName: decision.providerName,
    exhaustedProviders: decision.exhaustedProviders,
    retryable: decision.retryable,
    message: decision.message,
  };
}

function formatErrorMessageLegacy(error: unknown): string {
  if (error instanceof APIError && error.status !== undefined) {
    return `Claude API error (${error.status}): ${error.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown triage error";
}

function buildTriageInput(
  repo: Doc<"repos">,
  issue: Doc<"issues">,
): TriageInput {
  const repoContext =
    repo.language !== undefined
      ? {
          languages: [repo.language],
          hasTestFramework: false,
        }
      : undefined;

  return {
    repo: {
      owner: repo.owner,
      name: repo.name,
      defaultBranch: repo.defaultBranch,
    },
    issue: {
      number: Number(issue.githubIssueNumber),
      title: issue.title,
      body: issue.body ?? "",
      url: issue.githubIssueUrl,
      author: issue.authorLogin,
      labels: issue.labels,
      createdAt: new Date(
        issue.githubCreatedAt ?? issue.snapshotedAt,
      ).toISOString(),
    },
    ...(repoContext ? { repoContext } : {}),
  };
}

async function requestClaudeMessage(
  requestBody: MessageCreateParamsNonStreaming,
  logLabel: string,
) {
  const client = getAnthropicClient();
  const llmProvider = getLlmProvider();

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await client.messages.create(
        requestBody,
        getAnthropicRequestOptions(requestBody),
      );
    } catch (error) {
      const decision = getRetryDecision(error, llmProvider);

      if (!decision.retryable || attempt === RETRY_DELAYS_MS.length) {
        throw error;
      }

      const delayMs = RETRY_DELAYS_MS[attempt];
      console.warn(
        `[pipeline] Retrying ${logLabel} request after ${delayMs}ms (attempt ${attempt + 1})`,
        {
          attempt: attempt + 1,
          delayMs,
          ...buildLogContext(decision),
        },
      );
      await sleep(delayMs);
    }
  }

  throw new Error(`${logLabel} request exited without a Claude response`);
}

async function requestTriageAssessment(input: TriageInput) {
  const requestBody: MessageCreateParamsNonStreaming = {
    model: MODELS.triage,
    max_tokens: DEFAULT_MAX_TOKENS,
    system: TRIAGE_SYSTEM_PROMPT,
    tools: [TRIAGE_TOOL_DEFINITION],
    tool_choice: {
      type: "tool",
      name: TRIAGE_TOOL_NAME,
      disable_parallel_tool_use: true,
    },
    messages: [
      {
        role: "user",
        content: buildTriageUserPrompt(input),
      },
    ],
  };

  return await requestClaudeMessage(requestBody, "triage");
}

async function requestReproductionAttempt(userPrompt: string) {
  const requestBody: MessageCreateParamsNonStreaming = {
    model: MODELS.reproduce,
    max_tokens: 8192,
    system: REPRODUCER_SYSTEM_PROMPT,
    tools: [REPRO_PLAN_TOOL_DEFINITION, REPRO_ARTIFACT_TOOL_DEFINITION],
    messages: [
      {
        role: "user",
        content: userPrompt,
      },
    ],
  };

  return await requestClaudeMessage(requestBody, "reproducer");
}

async function loadRunContext(
  ctx: ActionCtx,
  runId: Id<"runs">,
  issueId?: Id<"issues">,
): Promise<{
  run: Doc<"runs">;
  issue: Doc<"issues">;
  repo: Doc<"repos">;
}> {
  const run: Doc<"runs"> | null = await ctx.runQuery(internal.runs.getById, {
    runId,
  });
  if (!run) {
    throw new Error(`Run ${runId} not found`);
  }

  if (issueId !== undefined && run.issueId !== issueId) {
    throw new Error(`Run ${runId} does not belong to issue ${issueId}`);
  }

  const expectedIssueId = issueId ?? run.issueId;

  const issue: Doc<"issues"> | null = await ctx.runQuery(internal.issues.getById, {
    issueId: run.issueId,
  });
  if (!issue) {
    throw new Error(`Issue ${expectedIssueId} not found`);
  }

  if (issue.repoId !== run.repoId) {
    throw new Error(
      `Issue ${expectedIssueId} does not belong to run ${runId}'s repository`,
    );
  }

  const repo: Doc<"repos"> | null = await ctx.runQuery(internal.repos.getById, {
    repoId: run.repoId,
  });
  if (!repo) {
    throw new Error(`Repo ${run.repoId} not found for run ${runId}`);
  }

  return { run, issue, repo };
}

async function resolveBaseRevision(
  ctx: ActionCtx,
  repo: Doc<"repos">,
): Promise<{ ref: string; sha: string }> {
  const installation = await ctx.runQuery(internal.githubInstallations.getById, {
    installationId: repo.installationId,
  });

  if (!installation) {
    throw new Error(
      `GitHub installation ${repo.installationId} not found for repo ${repo.fullName}`,
    );
  }

  const octokit = await getInstallationOctokit(Number(installation.installationId));
  const branch = await octokit.rest.repos.getBranch({
    owner: repo.owner,
    repo: repo.name,
    branch: repo.defaultBranch,
  });

  return {
    ref: `refs/heads/${repo.defaultBranch}`,
    sha: branch.data.commit.sha,
  };
}

function normalizeCloneRef(ref: string, defaultBranch: string): string {
  if (ref.startsWith("refs/heads/")) {
    return ref.slice("refs/heads/".length);
  }

  return ref || defaultBranch;
}

function normalizeLanguageHint(
  language: string | undefined,
): string | undefined {
  return language?.trim().toLowerCase() || undefined;
}

function normalizeRuntimeHint(
  runtime: string | undefined,
): string | undefined {
  const value = runtime?.trim();

  if (!value) {
    return undefined;
  }

  const match = value.match(/\d+(?:\.\d+)?/);
  return match?.[0] ?? value;
}

function buildPlannedSandboxCommands(
  commands: Array<{
    cwd: string;
    cmd: string;
  }>,
) {
  return commands.map((command, index) => ({
    name: index === commands.length - 1 ? "run_test" : `plan_step_${index + 1}`,
    cmd: command.cmd,
    cwd: command.cwd,
  }));
}

async function storeGeneratedReproContract(
  ctx: ActionCtx,
  runId: Id<"runs">,
  runIdentifier: string,
  triageArtifact: ReturnType<typeof buildTriageArtifact>,
) {
  const contract = generateReproContract(runIdentifier, triageArtifact);
  const validation = validateReproContractArtifact(contract);

  if (!validation.valid) {
    throw new Error(
      `Repro contract failed schema validation: ${validation.errors.join("; ")}`,
    );
  }

  await ctx.runMutation(
    internal.artifacts.storeReproContractFromAction,
    reproContractArtifactToMutationArgs(runId, contract),
  );

  return contract;
}

export const runTriage = internalAction({
  args: {
    runId: v.id("runs"),
    issueId: v.id("issues"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.runs.updateStatus, {
      runId: args.runId,
      status: "triaging",
    });

    try {
      const { run, issue, repo } = await loadRunContext(
        ctx,
        args.runId,
        args.issueId,
      );
      const triageInput = buildTriageInput(repo, issue);
      const response = await requestTriageAssessment(triageInput);
      const toolOutput = extractTriageFromResponse(response);

      if (!toolOutput) {
        throw new Error(
          `Claude did not return ${TRIAGE_TOOL_NAME}. Stop reason: ${response.stop_reason}; content blocks: ${response.content
            .map((block) => block.type)
            .join(", ")}`,
        );
      }

      const artifact = buildTriageArtifact(run.runId, triageInput, toolOutput);
      const validation = validateTriageArtifact(artifact);

      if (!validation.valid) {
        throw new Error(
          `Triage artifact failed schema validation: ${validation.errors.join("; ")}`,
        );
      }

      await ctx.runMutation(internal.artifacts.storeTriage, {
        runId: args.runId,
        artifact,
        tokensUsed: {
          input: response.usage.input_tokens,
          output: response.usage.output_tokens,
        },
      });

      if (toolOutput.repro_eligible) {
        const approval = await ctx.runQuery(internal.approvalGate.checkApproval, {
          repoId: issue.repoId,
          runId: args.runId,
          triageConfidence: toolOutput.classification.confidence,
          reproEligible: true,
        });

        if (approval.approved) {
          const approvedAt = Date.now();

          await ctx.runMutation(internal.runs.updateStatus, {
            runId: args.runId,
            status: "approved",
            approvedBy: "system:auto",
            approvedAt,
            errorMessage: approval.reason,
          });
          await ctx.scheduler.runAfter(0, internal.pipeline.runReproduce, {
            runId: args.runId,
          });
        } else {
          await ctx.runMutation(internal.runs.updateStatus, {
            runId: args.runId,
            status: "awaiting_approval",
            errorMessage: approval.reason,
          });
        }
      } else {
        await ctx.runMutation(internal.runs.updateStatus, {
          runId: args.runId,
          status: "completed",
        });
      }
    } catch (error) {
      const decision = getRetryDecision(error, getLlmProvider());
      const errorMessage =
        decision.llmProvider === "anthropic"
          ? formatErrorMessageLegacy(error)
          : formatErrorMessage(error, decision);

      console.error(
        `[pipeline] Triage failed for run ${args.runId}: ${errorMessage}`,
        buildLogContext(decision),
      );

      await ctx.runMutation(internal.runs.updateStatus, {
        runId: args.runId,
        status: "failed",
        errorMessage,
      });
    }

    return null;
  },
});

export const runReproduce = internalAction({
  args: {
    runId: v.id("runs"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.runs.updateStatus, {
      runId: args.runId,
      status: "reproducing",
    });

    let lastSandboxResult: Awaited<ReturnType<typeof executeSandbox>> | null = null;

    try {
      const { run, repo } = await loadRunContext(ctx, args.runId);
      const triageResult = await ctx.runQuery(
        internal.triageResults.getInternalByRunId,
        {
          runId: args.runId,
        },
      );

      if (!triageResult?.artifact) {
        throw new Error(`No triage artifact stored for run ${args.runId}`);
      }

      await storeGeneratedReproContract(
        ctx,
        args.runId,
        run.runId,
        triageResult.artifact,
      );

      const baseRevision = await resolveBaseRevision(ctx, repo);
      const languageHint = normalizeLanguageHint(
        triageResult.artifact.repro_hypothesis.environment_assumptions
          ?.language ?? repo.language,
      );
      const runtimeHint = normalizeRuntimeHint(
        triageResult.artifact.repro_hypothesis.environment_assumptions?.runtime,
      );

      let planArtifact:
        | ReturnType<typeof buildReproPlanArtifact>
        | null = null;
      let artifactOutput:
        | ReturnType<typeof extractReproArtifactFromResponse>
        | null = null;
      let previousFeedback:
        | ReturnType<typeof buildReproducerFeedback>
        | undefined;

      for (
        let iteration = 1;
        iteration <= MAX_REPRODUCTION_ITERATIONS;
        iteration += 1
      ) {
        const response = await requestReproductionAttempt(
          buildReproducerUserPrompt({
            triage: triageResult.artifact,
            repoContext: {
              languages: repo.language
                ? [repo.language]
                : languageHint
                  ? [languageHint]
                  : [],
              defaultBranch: repo.defaultBranch,
            },
            iteration,
            ...(previousFeedback ? { previousFeedback } : {}),
          }),
        );

        const nextPlanToolOutput = extractReproPlanFromResponse(response);

        if (nextPlanToolOutput) {
          const nextPlanArtifact = buildReproPlanArtifact({
            runId: run.runId,
            toolOutput: nextPlanToolOutput,
            defaultBaseRevision: baseRevision,
          });
          const validation = validateReproPlanArtifact(nextPlanArtifact);

          if (!validation.valid) {
            throw new Error(
              `Repro plan artifact failed schema validation: ${validation.errors.join("; ")}`,
            );
          }

          planArtifact = nextPlanArtifact;
          await ctx.runMutation(
            internal.artifacts.storeReproPlanFromAction,
            reproPlanArtifactToMutationArgs(args.runId, nextPlanArtifact),
          );
        }

        const nextArtifactOutput = extractReproArtifactFromResponse(response);

        if (nextArtifactOutput) {
          artifactOutput = nextArtifactOutput;
        }

        if (!planArtifact) {
          throw new Error(
            `Claude did not return ${REPRO_PLAN_TOOL_NAME}. Stop reason: ${response.stop_reason}; content blocks: ${response.content
              .map((block) => block.type)
              .join(", ")}`,
          );
        }

        if (!artifactOutput) {
          throw new Error(
            `Claude did not return ${REPRO_ARTIFACT_TOOL_NAME}. Stop reason: ${response.stop_reason}; content blocks: ${response.content
              .map((block) => block.type)
              .join(", ")}`,
          );
        }

        const plannedCommands = buildPlannedSandboxCommands(planArtifact.commands);
        const sandboxResult = await executeSandbox({
          runId: run.runId,
          repo: {
            cloneUrl: `https://github.com/${repo.owner}/${repo.name}.git`,
            ref: normalizeCloneRef(planArtifact.base_revision.ref, repo.defaultBranch),
            sha: planArtifact.base_revision.sha,
          },
          environment: {
            strategy: planArtifact.environment_strategy.preferred,
            ...(languageHint ? { languageHint } : {}),
            ...(runtimeHint ? { runtimeHint } : {}),
          },
          commands: [
            {
              name: "write_artifact",
              cmd: buildArtifactWriteCommand(artifactOutput),
            },
            ...plannedCommands,
          ],
          policy: {
            network: "disabled",
            runAsRoot: false,
            secretsMount: "none",
            wallClockTimeout: 1200,
            maxIterations: MAX_REPRODUCTION_ITERATIONS,
          },
        });

        lastSandboxResult = sandboxResult;

        const reproRunArtifact = buildReproRunArtifact({
          runId: run.runId,
          iteration,
          sandboxResult,
          artifactContent: artifactOutput.content,
        });
        const reproRunValidation = validateReproRunArtifact(reproRunArtifact);

        if (!reproRunValidation.valid) {
          throw new Error(
            `Repro run artifact failed schema validation: ${reproRunValidation.errors.join("; ")}`,
          );
        }

        await ctx.runMutation(
          internal.artifacts.storeReproRunFromAction,
          reproRunArtifactToMutationArgs(args.runId, reproRunArtifact),
        );

        const relevantStep = findRelevantReproStep(
          sandboxResult,
          plannedCommands.map((command) => command.name),
        );

        if (
          matchesExpectedFailureSignal(
            sandboxResult,
            relevantStep,
            triageResult.artifact.repro_hypothesis.expected_failure_signal,
          )
        ) {
          await ctx.runMutation(internal.runs.updateStatus, {
            runId: args.runId,
            status: "verifying",
          });
          await ctx.scheduler.runAfter(0, internal.pipeline.runVerify, {
            runId: args.runId,
          });
          return null;
        }

        previousFeedback = buildReproducerFeedback(sandboxResult);
      }

      await ctx.runMutation(internal.runs.updateStatus, {
        runId: args.runId,
        status: "failed",
        verdict:
          lastSandboxResult?.failureType === "env_setup"
            ? "env_setup_failed"
            : "budget_exhausted",
        errorMessage: `Failed to reproduce after ${MAX_REPRODUCTION_ITERATIONS} iterations`,
      });
    } catch (error) {
      await ctx.runMutation(internal.runs.updateStatus, {
        runId: args.runId,
        status: "failed",
        ...(lastSandboxResult?.failureType === "env_setup"
          ? { verdict: "env_setup_failed" as const }
          : {}),
        errorMessage: formatErrorMessageLegacy(error),
      });
    }

    return null;
  },
});

export const runVerify = internalAction({
  args: {
    runId: v.id("runs"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.runs.updateStatus, {
      runId: args.runId,
      status: "verifying",
    });

    try {
      const { run, repo } = await loadRunContext(ctx, args.runId);
      const triageResult = await ctx.runQuery(
        internal.triageResults.getInternalByRunId,
        { runId: args.runId },
      );
      const reproPlan = await ctx.runQuery(
        internal.reproPlans.getInternalByRunId,
        { runId: args.runId },
      );
      const reproRun = await ctx.runQuery(
        internal.reproRuns.getInternalByRunId,
        { runId: args.runId },
      );

      if (!triageResult?.artifact || !reproPlan || !reproRun?.artifactContent) {
        throw new Error(
          `Missing triage, repro plan, or repro run artifact for verification of run ${args.runId}`,
        );
      }

      const contract = await storeGeneratedReproContract(
        ctx,
        args.runId,
        run.runId,
        triageResult.artifact,
      );
      const plannedCommands = buildPlannedSandboxCommands(reproPlan.commands);
      const languageHint = normalizeLanguageHint(
        triageResult.artifact.repro_hypothesis.environment_assumptions
          ?.language ?? repo.language,
      );
      const runtimeHint = normalizeRuntimeHint(
        triageResult.artifact.repro_hypothesis.environment_assumptions?.runtime,
      );
      const rerunResults = [];

      for (
        let rerunIndex = 1;
        rerunIndex <= contract.acceptance.must_be_deterministic.reruns;
        rerunIndex += 1
      ) {
        const rerunResult = await executeSandbox({
          runId: `${run.runId}_verify_${rerunIndex}`,
          repo: {
            cloneUrl: `https://github.com/${repo.owner}/${repo.name}.git`,
            ref: normalizeCloneRef(reproPlan.baseRevision.ref, repo.defaultBranch),
            sha: reproPlan.baseRevision.sha,
          },
          environment: {
            strategy:
              normalizeStrategy(reproPlan.environmentStrategy.preferred) ??
              "bootstrap",
            ...(languageHint ? { languageHint } : {}),
            ...(runtimeHint ? { runtimeHint } : {}),
          },
          commands: [
            {
              name: "write_artifact",
              cmd: buildArtifactWriteCommand({
                file_path: reproPlan.artifact.path,
                content: reproRun.artifactContent,
                language: "shell",
              }),
            },
            ...plannedCommands,
          ],
          policy: {
            network: contract.sandbox_policy.network,
            runAsRoot: false,
            secretsMount: "none",
            wallClockTimeout: contract.budgets.wall_clock_seconds,
            maxIterations: contract.budgets.max_iterations,
          },
        });

        rerunResults.push(rerunResult);
      }

      const verification = verifyReproduction(contract, rerunResults, {
        file_path: reproPlan.artifact.path,
        content: reproRun.artifactContent,
      });
      const validation = validateVerificationArtifact(verification);

      if (!validation.valid) {
        throw new Error(
          `Verification artifact failed schema validation: ${validation.errors.join("; ")}`,
        );
      }

      await ctx.runMutation(
        internal.artifacts.storeVerificationFromAction,
        verificationArtifactToMutationArgs(args.runId, verification),
      );
    } catch (error) {
      await ctx.runMutation(internal.runs.updateStatus, {
        runId: args.runId,
        status: "failed",
        errorMessage: formatErrorMessageLegacy(error),
      });
    }

    return null;
  },
});
