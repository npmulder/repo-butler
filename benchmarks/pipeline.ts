import {
  APIConnectionError,
  APIError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";

import {
  DEFAULT_MAX_TOKENS,
  MODELS,
  getAnthropicClient,
  getAnthropicRequestOptions,
  getLlmProvider,
  type LlmProvider,
  type TriageInput,
} from "../lib/claude";
import {
  MAX_REPRODUCTION_ITERATIONS,
  REPRO_ARTIFACT_TOOL_DEFINITION,
  REPRO_ARTIFACT_TOOL_NAME,
  REPRO_PLAN_TOOL_DEFINITION,
  REPRO_PLAN_TOOL_NAME,
  REPRODUCER_SYSTEM_PROMPT,
  buildReproducerUserPrompt,
} from "../lib/prompts/reproducer";
import {
  TRIAGE_SYSTEM_PROMPT,
  TRIAGE_TOOL_DEFINITION,
  TRIAGE_TOOL_NAME,
  buildTriageUserPrompt,
} from "../lib/prompts/triage";
import { generateReproContract } from "../lib/prompts/verifier";
import {
  buildArtifactWriteCommand,
  buildReproPlanArtifact,
  buildReproRunArtifact,
  buildReproducerFeedback,
  extractReproArtifactFromResponse,
  extractReproPlanFromResponse,
  findRelevantReproStep,
  matchesExpectedFailureSignal,
  validateReproPlanArtifact,
  validateReproRunArtifact,
} from "../lib/repro-parser";
import {
  buildTriageArtifact,
  extractTriageFromResponse,
  validateTriageArtifact,
} from "../lib/triage-parser";
import {
  validateVerificationArtifact,
  verifyReproduction,
} from "../lib/verification";
import { normalizeStrategy } from "../worker/env-strategy";
import { runSandbox } from "../worker/sandbox-runner";
import type {
  SandboxCommand,
  SandboxRequest,
  SandboxResult,
} from "../worker/types";
import type {
  BenchmarkFixture,
  BenchmarkPipeline,
  BenchmarkReproductionResult,
  BenchmarkTriageResult,
  BenchmarkVerificationResult,
} from "./types";

const RETRY_DELAYS_MS = [1_000, 3_000, 5_000] as const;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

type RetryDecision = {
  code?: number | string;
  exhaustedProviders: boolean;
  llmProvider: LlmProvider;
  message: string;
  retryable: boolean;
  status?: number;
};

type SandboxRunner = (request: SandboxRequest) => Promise<SandboxResult>;

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
    "Unknown benchmark LLM error";
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
          code === 429 ||
          lowerCode === "rate_limit_exceeded" ||
          lowerMessage.includes("rate limit"))
      : error instanceof APIError && RETRYABLE_STATUSES.has(status ?? 0));

  return {
    code,
    exhaustedProviders,
    llmProvider,
    message,
    retryable,
    status,
  };
}

async function requestClaudeMessage(
  requestBody: MessageCreateParamsNonStreaming,
  label: string,
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

      await sleep(RETRY_DELAYS_MS[attempt]);
      console.warn(
        `[benchmarks] Retrying ${label} request`,
        {
          attempt: attempt + 1,
          code: decision.code,
          llmProvider: decision.llmProvider,
          message: decision.message,
          status: decision.status,
        },
      );
    }
  }

  throw new Error(`${label} request completed without a response`);
}

function buildTriageInput(fixture: BenchmarkFixture): TriageInput {
  return {
    repo: {
      owner: fixture.repo.owner,
      name: fixture.repo.name,
      defaultBranch: fixture.repo.ref,
    },
    issue: {
      number: fixture.issue.number,
      title: fixture.issue.title,
      body: fixture.issue.body,
      url: fixture.issue.url,
      author: fixture.issue.author ?? "benchmark-fixture",
      labels: [...fixture.issue.labels],
      createdAt: fixture.issue.createdAt ?? new Date(0).toISOString(),
    },
    repoContext: {
      languages: [fixture.repo.language ?? "Python"],
      hasTestFramework: true,
      testCommand: "pytest",
    },
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
  const trimmed = runtime?.trim();

  if (!trimmed) {
    return undefined;
  }

  const versionMatch = trimmed.match(/\d+(?:\.\d+)?/);
  return versionMatch?.[0] ?? trimmed;
}

function buildPlannedSandboxCommands(
  commands: Array<{ cwd: string; cmd: string }>,
): SandboxCommand[] {
  return commands.map((command, index) => ({
    name: index === commands.length - 1 ? "run_test" : `plan_step_${index + 1}`,
    cmd: command.cmd,
    cwd: command.cwd,
  }));
}

function buildVerificationPolicy(
  timeoutSeconds: number,
): SandboxRequest["policy"] {
  return {
    network: "disabled",
    runAsRoot: false,
    secretsMount: "none",
    wallClockTimeout: timeoutSeconds,
    maxIterations: MAX_REPRODUCTION_ITERATIONS,
  };
}

function buildSandboxRequestForRevision(
  fixture: BenchmarkFixture,
  reproduction: BenchmarkReproductionResult,
  revisionSha: string,
  timeoutSeconds: number,
): SandboxRequest {
  if (!reproduction.planArtifact || !reproduction.artifact) {
    throw new Error(
      `Missing plan or reproduction artifact for fixture ${fixture.id}`,
    );
  }

  const plannedCommands = buildPlannedSandboxCommands(
    reproduction.planArtifact.commands,
  );

  return {
    runId: `${fixture.id}:${revisionSha.slice(0, 12)}`,
    repo: {
      cloneUrl: `https://github.com/${fixture.repo.owner}/${fixture.repo.name}.git`,
      ref: normalizeCloneRef(reproduction.planArtifact.base_revision.ref, fixture.repo.ref),
      sha: revisionSha,
    },
    environment: {
      strategy:
        normalizeStrategy(reproduction.planArtifact.environment_strategy.preferred) ??
        "bootstrap",
      ...(normalizeLanguageHint(fixture.repo.language)
        ? { languageHint: normalizeLanguageHint(fixture.repo.language) }
        : {}),
      ...(normalizeRuntimeHint(fixture.repo.runtimeHint)
        ? { runtimeHint: normalizeRuntimeHint(fixture.repo.runtimeHint) }
        : {}),
    },
    commands: [
      {
        name: "write_artifact",
        cmd: buildArtifactWriteCommand(reproduction.artifact),
      },
      ...plannedCommands,
    ],
    policy: buildVerificationPolicy(timeoutSeconds),
  };
}

function isInconclusiveFailToPassResult(result: SandboxResult): boolean {
  return (
    result.failureType === "env_setup" ||
    result.status === "timeout" ||
    result.status === "error"
  );
}

export async function evaluateFailToPass(
  fixture: BenchmarkFixture,
  reproduction: BenchmarkReproductionResult,
  timeoutSeconds: number,
  sandboxRunner: SandboxRunner = runSandbox,
): Promise<boolean | null> {
  if (!fixture.repo.fixSha || !reproduction.planArtifact || !reproduction.artifact) {
    return null;
  }

  const baseResult = await sandboxRunner(
    buildSandboxRequestForRevision(
      fixture,
      reproduction,
      fixture.repo.sha,
      timeoutSeconds,
    ),
  );
  const fixedResult = await sandboxRunner(
    buildSandboxRequestForRevision(
      fixture,
      reproduction,
      fixture.repo.fixSha,
      timeoutSeconds,
    ),
  );

  if (
    isInconclusiveFailToPassResult(baseResult) ||
    isInconclusiveFailToPassResult(fixedResult)
  ) {
    return null;
  }

  if (baseResult.status !== "failure") {
    return null;
  }

  if (fixedResult.status === "success") {
    return true;
  }

  if (fixedResult.status === "failure") {
    return false;
  }

  return null;
}

export function createLocalBenchmarkPipeline(options?: {
  sandboxRunner?: SandboxRunner;
}): BenchmarkPipeline {
  const sandboxRunner = options?.sandboxRunner ?? runSandbox;

  return {
    async runTriage(fixture): Promise<BenchmarkTriageResult> {
      const triageInput = buildTriageInput(fixture);
      const response = await requestClaudeMessage(
        {
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
              content: buildTriageUserPrompt(triageInput),
            },
          ],
        },
        "triage",
      );
      const toolOutput = extractTriageFromResponse(response);

      if (!toolOutput) {
        throw new Error(
          `Claude did not return ${TRIAGE_TOOL_NAME} for fixture ${fixture.id}`,
        );
      }

      const artifact = buildTriageArtifact(fixture.id, triageInput, toolOutput);
      const validation = validateTriageArtifact(artifact);

      if (!validation.valid) {
        throw new Error(
          `Triage artifact failed schema validation for ${fixture.id}: ${validation.errors.join("; ")}`,
        );
      }

      return {
        artifact,
        classificationType: artifact.classification.type,
        reproEligible: artifact.repro_eligible,
      };
    },

    async runReproduction(
      fixture,
      triage,
      timeoutSeconds,
    ): Promise<BenchmarkReproductionResult> {
      const baseRevision = {
        ref: `refs/heads/${fixture.repo.ref}`,
        sha: fixture.repo.sha,
      };
      let previousFeedback:
        | ReturnType<typeof buildReproducerFeedback>
        | undefined;
      let lastSandboxResult: SandboxResult | undefined;

      for (
        let iteration = 1;
        iteration <= MAX_REPRODUCTION_ITERATIONS;
        iteration += 1
      ) {
        const response = await requestClaudeMessage(
          {
            model: MODELS.reproduce,
            max_tokens: 8192,
            system: REPRODUCER_SYSTEM_PROMPT,
            tools: [REPRO_PLAN_TOOL_DEFINITION, REPRO_ARTIFACT_TOOL_DEFINITION],
            messages: [
              {
                role: "user",
                content: buildReproducerUserPrompt({
                  triage: triage.artifact,
                  repoContext: {
                    languages: [fixture.repo.language ?? "python"],
                    defaultBranch: fixture.repo.ref,
                  },
                  iteration,
                  ...(previousFeedback ? { previousFeedback } : {}),
                }),
              },
            ],
          },
          `reproduction:${fixture.id}:${iteration}`,
        );
        const planToolOutput = extractReproPlanFromResponse(response);
        const artifactToolOutput = extractReproArtifactFromResponse(response);

        if (!planToolOutput) {
          throw new Error(
            `Claude did not return ${REPRO_PLAN_TOOL_NAME} for fixture ${fixture.id}`,
          );
        }

        if (!artifactToolOutput) {
          throw new Error(
            `Claude did not return ${REPRO_ARTIFACT_TOOL_NAME} for fixture ${fixture.id}`,
          );
        }

        const planArtifact = buildReproPlanArtifact({
          runId: fixture.id,
          toolOutput: planToolOutput,
          defaultBaseRevision: baseRevision,
        });
        const planValidation = validateReproPlanArtifact(planArtifact);

        if (!planValidation.valid) {
          throw new Error(
            `Repro plan validation failed for ${fixture.id}: ${planValidation.errors.join("; ")}`,
          );
        }

        const plannedCommands = buildPlannedSandboxCommands(planArtifact.commands);
        const sandboxResult = await sandboxRunner({
          runId: fixture.id,
          repo: {
            cloneUrl: `https://github.com/${fixture.repo.owner}/${fixture.repo.name}.git`,
            ref: normalizeCloneRef(planArtifact.base_revision.ref, fixture.repo.ref),
            sha: planArtifact.base_revision.sha,
          },
          environment: {
            strategy: planArtifact.environment_strategy.preferred,
            ...(normalizeLanguageHint(fixture.repo.language)
              ? { languageHint: normalizeLanguageHint(fixture.repo.language) }
              : {}),
            ...(normalizeRuntimeHint(fixture.repo.runtimeHint)
              ? { runtimeHint: normalizeRuntimeHint(fixture.repo.runtimeHint) }
              : {}),
          },
          commands: [
            {
              name: "write_artifact",
              cmd: buildArtifactWriteCommand(artifactToolOutput),
            },
            ...plannedCommands,
          ],
          policy: buildVerificationPolicy(timeoutSeconds),
        });

        lastSandboxResult = sandboxResult;
        const runArtifact = buildReproRunArtifact({
          runId: fixture.id,
          iteration,
          sandboxResult,
          artifactContent: artifactToolOutput.content,
        });
        const runValidation = validateReproRunArtifact(runArtifact);

        if (!runValidation.valid) {
          throw new Error(
            `Repro run validation failed for ${fixture.id}: ${runValidation.errors.join("; ")}`,
          );
        }

        const relevantStep = findRelevantReproStep(
          sandboxResult,
          plannedCommands.map((command) => command.name),
        );

        if (
          matchesExpectedFailureSignal(
            sandboxResult,
            relevantStep,
            triage.artifact.repro_hypothesis.expected_failure_signal,
          )
        ) {
          return {
            succeeded: true,
            artifact: artifactToolOutput,
            iterations: iteration,
            envSetupFailed: false,
            planArtifact,
            runArtifact,
            lastSandboxResult: sandboxResult,
          };
        }

        previousFeedback = buildReproducerFeedback(sandboxResult);
      }

      return {
        succeeded: false,
        iterations: MAX_REPRODUCTION_ITERATIONS,
        envSetupFailed: lastSandboxResult?.failureType === "env_setup",
        lastSandboxResult,
      };
    },

    async runVerification(
      fixture,
      triage,
      reproduction,
      timeoutSeconds,
    ): Promise<BenchmarkVerificationResult> {
      if (!reproduction.planArtifact || !reproduction.artifact) {
        throw new Error(
          `Missing reproduction plan or artifact for fixture ${fixture.id}`,
        );
      }

      const contract = generateReproContract(fixture.id, triage.artifact);
      const rerunResults: SandboxResult[] = [];

      for (
        let rerunIndex = 1;
        rerunIndex <= contract.acceptance.must_be_deterministic.reruns;
        rerunIndex += 1
      ) {
        const request = buildSandboxRequestForRevision(
          fixture,
          reproduction,
          reproduction.planArtifact.base_revision.sha,
          timeoutSeconds,
        );
        request.runId = `${fixture.id}:verify:${rerunIndex}`;
        rerunResults.push(await sandboxRunner(request));
      }

      const artifact = verifyReproduction(contract, rerunResults, {
        file_path: reproduction.artifact.file_path,
        content: reproduction.artifact.content,
      });
      const validation = validateVerificationArtifact(artifact);

      if (!validation.valid) {
        throw new Error(
          `Verification artifact failed schema validation for ${fixture.id}: ${validation.errors.join("; ")}`,
        );
      }

      return {
        artifact,
        verdict: artifact.verdict,
        rerunResults,
      };
    },

    async checkFailToPass(
      fixture,
      reproduction,
      timeoutSeconds,
    ): Promise<boolean | null> {
      return await evaluateFailToPass(
        fixture,
        reproduction,
        timeoutSeconds,
        sandboxRunner,
      );
    },
  };
}
