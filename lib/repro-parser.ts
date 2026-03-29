import path from "node:path";

import type {
  Message,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages/messages";

import type { TriageArtifact } from "./triage-parser";
import type { ReproPlan } from "./generated/repro-plan.v1";
import type { ReproRun } from "./generated/repro-run.v1";
import {
  REPRO_ARTIFACT_TOOL_NAME,
  REPRO_PLAN_TOOL_NAME,
  type ReproducerFeedback,
} from "./prompts/reproducer";
import { validateArtifact } from "./schema-validator";
import {
  getFallbackStrategies,
  normalizeStrategy,
  type StrategyType,
} from "../worker/env-strategy";
import type { SandboxResult, StepResult } from "../worker/types";

const DEFAULT_REPRO_CWD = ".";
const HEREDOC_DELIMITER_BASE = "REPRO_EOF_MARKER";

export type ReproPlanToolOutput = {
  base_revision: {
    ref: string;
    sha?: string;
  };
  environment_strategy: {
    preferred: StrategyType;
    notes?: string;
  };
  commands: Array<{
    cwd?: string;
    cmd: string;
    name?: string;
  }>;
  artifact: {
    type:
      | "pytest_test"
      | "vitest_test"
      | "jest_test"
      | "mocha_test"
      | "go_test"
      | "script";
    path: string;
    entrypoint?: string;
  };
};

export type ReproArtifactToolOutput = {
  file_path: string;
  content: string;
  language: "python" | "typescript" | "javascript" | "go" | "ruby" | "shell";
};

function isToolUseBlock(
  block: Message["content"][number],
  toolName: string,
): block is ToolUseBlock {
  return block.type === "tool_use" && block.name === toolName;
}

function normalizeCwd(cwd?: string): string {
  return cwd?.trim() ? cwd : DEFAULT_REPRO_CWD;
}

function normalizeStrategyOrDefault(strategy: string | undefined): StrategyType {
  return normalizeStrategy(strategy) ?? "bootstrap";
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function chooseHereDocDelimiter(content: string): string {
  let suffix = 0;
  let delimiter = HEREDOC_DELIMITER_BASE;

  while (content.includes(delimiter)) {
    suffix += 1;
    delimiter = `${HEREDOC_DELIMITER_BASE}_${suffix}`;
  }

  return delimiter;
}

export function extractToolCall<T>(
  response: Message,
  toolName: string,
): T | null {
  const toolBlock = response.content.find((block) => isToolUseBlock(block, toolName));
  return toolBlock ? (toolBlock.input as T) : null;
}

export function extractReproPlanFromResponse(
  response: Message,
): ReproPlanToolOutput | null {
  return extractToolCall<ReproPlanToolOutput>(response, REPRO_PLAN_TOOL_NAME);
}

export function extractReproArtifactFromResponse(
  response: Message,
): ReproArtifactToolOutput | null {
  return extractToolCall<ReproArtifactToolOutput>(response, REPRO_ARTIFACT_TOOL_NAME);
}

export function buildReproPlanArtifact(input: {
  runId: string;
  toolOutput: ReproPlanToolOutput;
  defaultBaseRevision: {
    ref: string;
    sha: string;
  };
}): ReproPlan {
  const commands = input.toolOutput.commands
    .filter((command) => command.cmd.trim().length > 0)
    .map((command) => ({
      cwd: normalizeCwd(command.cwd),
      cmd: command.cmd,
    }));

  if (commands.length === 0) {
    throw new Error("Reproducer plan must include at least one command");
  }

  const preferred = normalizeStrategyOrDefault(
    input.toolOutput.environment_strategy.preferred,
  );

  return {
    schema_version: "rb.repro_plan.v1",
    run_id: input.runId,
    base_revision: {
      ref:
        input.toolOutput.base_revision.ref.trim() ||
        input.defaultBaseRevision.ref,
      sha:
        input.toolOutput.base_revision.sha?.trim() ||
        input.defaultBaseRevision.sha,
    },
    environment_strategy: {
      preferred,
      detected: preferred,
      fallbacks: getFallbackStrategies(preferred),
      ...(input.toolOutput.environment_strategy.notes?.trim()
        ? { notes: input.toolOutput.environment_strategy.notes.trim() }
        : {}),
    },
    commands: commands as ReproPlan["commands"],
    artifact: {
      type: input.toolOutput.artifact.type,
      path: input.toolOutput.artifact.path,
      ...(input.toolOutput.artifact.entrypoint?.trim()
        ? { entrypoint: input.toolOutput.artifact.entrypoint.trim() }
        : {}),
    },
  };
}

export function reproPlanArtifactToMutationArgs<RunId extends string>(
  runId: RunId,
  artifact: ReproPlan,
) {
  return {
    runId,
    schemaVersion: artifact.schema_version,
    baseRevision: {
      ref: artifact.base_revision.ref,
      sha: artifact.base_revision.sha,
    },
    environmentStrategy: {
      preferred: artifact.environment_strategy.preferred,
      detected: artifact.environment_strategy.detected,
      fallbacks: [...artifact.environment_strategy.fallbacks],
      ...(artifact.environment_strategy.notes
        ? { notes: artifact.environment_strategy.notes }
        : {}),
      ...(artifact.environment_strategy.image_used
        ? { imageUsed: artifact.environment_strategy.image_used }
        : {}),
    },
    commands: artifact.commands.map((command) => ({
      cwd: command.cwd,
      cmd: command.cmd,
    })),
    artifact: {
      type: artifact.artifact.type,
      path: artifact.artifact.path,
      ...(artifact.artifact.entrypoint
        ? { entrypoint: artifact.artifact.entrypoint }
        : {}),
    },
  };
}

export function buildReproRunArtifact(input: {
  runId: string;
  iteration: number;
  sandboxResult: SandboxResult;
  artifactContent?: string;
}): ReproRun {
  return {
    schema_version: "rb.repro_run.v1",
    run_id: input.runId,
    iteration: input.iteration,
    sandbox: {
      kind: input.sandboxResult.sandbox.kind,
      ...(input.sandboxResult.sandbox.imageDigest
        ? { image_digest: input.sandboxResult.sandbox.imageDigest }
        : {}),
      network: input.sandboxResult.sandbox.network,
      ...(typeof input.sandboxResult.sandbox.uid === "number"
        ? { uid: input.sandboxResult.sandbox.uid }
        : {}),
    },
    steps: input.sandboxResult.steps.map((step) => ({
      name: step.name,
      cmd: step.cmd,
      exit_code: step.exitCode,
      ...(step.stdoutSha256 ? { stdout_sha256: step.stdoutSha256 } : {}),
      ...(step.stderrSha256 ? { stderr_sha256: step.stderrSha256 } : {}),
      ...(typeof step.durationMs === "number"
        ? { duration_ms: step.durationMs }
        : {}),
    })),
    ...(input.sandboxResult.failureObserved
      ? {
          failure_observed: {
            kind: input.sandboxResult.failureObserved.kind,
            ...(input.sandboxResult.failureObserved.matchAny
              ? { match_any: input.sandboxResult.failureObserved.matchAny }
              : {}),
            ...(input.sandboxResult.failureObserved.traceExcerptSha256
              ? {
                  trace_excerpt_sha256:
                    input.sandboxResult.failureObserved.traceExcerptSha256,
                }
              : {}),
          },
        }
      : {}),
    ...(input.sandboxResult.failureType
      ? { failure_type: input.sandboxResult.failureType }
      : {}),
    ...(input.sandboxResult.environmentStrategy
      ? {
          environment_strategy: {
            attempted:
              input.sandboxResult.environmentStrategy.attempted ??
              input.sandboxResult.environmentStrategy.detected ??
              input.sandboxResult.environmentStrategy.preferred,
            ...(input.sandboxResult.environmentStrategy.detected
              ? { detected: input.sandboxResult.environmentStrategy.detected }
              : {}),
            ...(input.sandboxResult.environmentStrategy.failedAt
              ? { failed_at: input.sandboxResult.environmentStrategy.failedAt }
              : {}),
            ...(input.sandboxResult.environmentStrategy.notes
              ? { notes: input.sandboxResult.environmentStrategy.notes }
              : {}),
            ...(input.sandboxResult.environmentStrategy.imageUsed
              ? { image_used: input.sandboxResult.environmentStrategy.imageUsed }
              : {}),
          },
        }
      : {}),
    ...(input.artifactContent ? { artifact_content: input.artifactContent } : {}),
    duration_ms: input.sandboxResult.totalDurationMs,
  };
}

export function reproRunArtifactToMutationArgs<RunId extends string>(
  runId: RunId,
  artifact: ReproRun,
) {
  return {
    runId,
    schemaVersion: artifact.schema_version,
    iteration: BigInt(artifact.iteration),
    sandbox: {
      kind: artifact.sandbox.kind,
      ...(artifact.sandbox.image_digest
        ? { imageDigest: artifact.sandbox.image_digest }
        : {}),
      network: artifact.sandbox.network,
      ...(typeof artifact.sandbox.uid === "number"
        ? { uid: BigInt(artifact.sandbox.uid) }
        : {}),
    },
    steps: artifact.steps.map((step) => ({
      name: step.name,
      cmd: step.cmd,
      exitCode: BigInt(step.exit_code),
      ...(step.stdout_sha256 ? { stdoutSha256: step.stdout_sha256 } : {}),
      ...(step.stderr_sha256 ? { stderrSha256: step.stderr_sha256 } : {}),
      ...(typeof step.duration_ms === "number"
        ? { durationMs: BigInt(step.duration_ms) }
        : {}),
    })),
    ...(artifact.failure_observed
      ? {
          failureObserved: {
            kind: artifact.failure_observed.kind,
            ...(artifact.failure_observed.match_any
              ? { matchAny: artifact.failure_observed.match_any }
              : {}),
            ...(artifact.failure_observed.trace_excerpt_sha256
              ? {
                  traceExcerptSha256:
                    artifact.failure_observed.trace_excerpt_sha256,
                }
              : {}),
          },
        }
      : {}),
    ...(artifact.failure_type ? { failureType: artifact.failure_type } : {}),
    ...(artifact.environment_strategy
      ? {
          environmentStrategy: {
            attempted: artifact.environment_strategy.attempted,
            ...(artifact.environment_strategy.detected
              ? { detected: artifact.environment_strategy.detected }
              : {}),
            ...(artifact.environment_strategy.failed_at
              ? { failedAt: artifact.environment_strategy.failed_at }
              : {}),
            ...(artifact.environment_strategy.notes
              ? { notes: artifact.environment_strategy.notes }
              : {}),
            ...(artifact.environment_strategy.image_used
              ? { imageUsed: artifact.environment_strategy.image_used }
              : {}),
          },
        }
      : {}),
    ...(artifact.artifact_content
      ? { artifactContent: artifact.artifact_content }
      : {}),
    durationMs: BigInt(artifact.duration_ms),
  };
}

export function validateReproPlanArtifact(
  artifact: ReproPlan,
): { valid: true } | { valid: false; errors: string[] } {
  return validateArtifact("rb.repro_plan.v1", artifact);
}

export function validateReproRunArtifact(
  artifact: ReproRun,
): { valid: true } | { valid: false; errors: string[] } {
  return validateArtifact("rb.repro_run.v1", artifact);
}

export function buildArtifactWriteCommand(
  artifact: ReproArtifactToolOutput,
): string {
  const delimiter = chooseHereDocDelimiter(artifact.content);
  const directory = path.posix.dirname(artifact.file_path);

  return [
    `mkdir -p ${shellQuote(directory)}`,
    `cat <<'${delimiter}' > ${shellQuote(artifact.file_path)}`,
    artifact.content,
    delimiter,
  ].join("\n");
}

export function analyzeSandboxFailure(result: SandboxResult): string {
  if (result.status === "timeout") {
    return "Execution timed out";
  }

  if (result.status === "error") {
    return "Sandbox setup error";
  }

  const firstFailedStep = result.steps.find((step) => step.exitCode !== 0);

  if (!firstFailedStep) {
    return "All commands succeeded - expected failure signal did not appear";
  }

  if (firstFailedStep.name === "write_artifact") {
    return "Failed to write reproduction artifact";
  }

  const stderr = firstFailedStep.stderrTail ?? "";

  if (
    stderr.includes("ModuleNotFoundError") ||
    stderr.includes("Cannot find module") ||
    stderr.includes("ERR_MODULE_NOT_FOUND")
  ) {
    return "Import error - missing module or incorrect path";
  }

  if (stderr.includes("SyntaxError")) {
    return "Syntax error in generated code";
  }

  if (
    stderr.includes("FileNotFoundError") ||
    stderr.includes("ENOENT") ||
    stderr.includes("No such file or directory")
  ) {
    return "File not found - check repository-relative paths";
  }

  return `Command '${firstFailedStep.name}' failed with exit code ${firstFailedStep.exitCode}`;
}

export function buildReproducerFeedback(
  result: SandboxResult,
): ReproducerFeedback {
  const fallbackStep = result.steps[result.steps.length - 1];
  const feedbackStep =
    [...result.steps].reverse().find((step) => step.exitCode !== 0) ??
    fallbackStep;

  return {
    exitCode: feedbackStep?.exitCode ?? -1,
    stderrTail: truncateOutputTail(feedbackStep?.stderrTail ?? ""),
    stdoutTail: truncateOutputTail(feedbackStep?.stdoutTail ?? ""),
    failureAnalysis: analyzeSandboxFailure(result),
  };
}

export function truncateOutputTail(text: string, maxLines = 500): string {
  if (!text) {
    return "";
  }

  const lines = text.split("\n");
  return lines.slice(-maxLines).join("\n");
}

export function findRelevantReproStep(
  result: SandboxResult,
  commandNames: string[],
): StepResult | undefined {
  if (commandNames.length === 0) {
    return result.steps[result.steps.length - 1];
  }

  const byName = [...result.steps]
    .reverse()
    .find((step) => commandNames.includes(step.name));

  return byName ?? result.steps[result.steps.length - 1];
}

export function matchesExpectedFailureSignal(
  result: SandboxResult,
  step: StepResult | undefined,
  signal: TriageArtifact["repro_hypothesis"]["expected_failure_signal"],
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
