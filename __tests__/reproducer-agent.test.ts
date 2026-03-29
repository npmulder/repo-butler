import type { Message } from "@anthropic-ai/sdk/resources/messages/messages";
import { describe, expect, it } from "vitest";

import type {
  ReproArtifactToolOutput,
  ReproPlanToolOutput,
} from "../lib/repro-parser";
import {
  analyzeSandboxFailure,
  buildArtifactWriteCommand,
  buildReproPlanArtifact,
  buildReproRunArtifact,
  buildReproducerFeedback,
  extractReproArtifactFromResponse,
  extractReproPlanFromResponse,
  matchesExpectedFailureSignal,
  validateReproPlanArtifact,
  validateReproRunArtifact,
} from "../lib/repro-parser";
import {
  REPRO_ARTIFACT_TOOL_NAME,
  REPRO_PLAN_TOOL_NAME,
  buildReproducerUserPrompt,
} from "../lib/prompts/reproducer";
import { sampleTriageArtifacts } from "./fixtures/sample-triage";

function buildPlanToolOutput(): ReproPlanToolOutput {
  return {
    base_revision: {
      ref: "refs/heads/main",
    },
    environment_strategy: {
      preferred: "dockerfile",
      notes: "Use the repo Dockerfile before falling back to synthesis.",
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

function buildArtifactToolOutput(): ReproArtifactToolOutput {
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
  };
}

function buildMessage(
  plan: ReproPlanToolOutput,
  artifact: ReproArtifactToolOutput,
): Message {
  return {
    id: "msg_repro_test_123",
    container: null,
    content: [
      { type: "text", text: "Submitting the reproduction plan." },
      {
        type: "tool_use",
        id: "toolu_plan_123",
        name: REPRO_PLAN_TOOL_NAME,
        input: plan,
      },
      {
        type: "tool_use",
        id: "toolu_artifact_123",
        name: REPRO_ARTIFACT_TOOL_NAME,
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
      input_tokens: 400,
      output_tokens: 300,
      server_tool_use: null,
    },
  } as unknown as Message;
}

function buildSandboxResult(overrides: Partial<{
  status: "success" | "failure" | "error" | "timeout";
  stderrTail: string;
  stdoutTail: string;
  exitCode: number;
}> = {}) {
  return {
    runId: "run_repro_fixture",
    status: overrides.status ?? "failure",
    failureType: "repro_failure" as const,
    sandbox: {
      kind: "docker" as const,
      imageDigest: "sha256:123",
      network: "disabled" as const,
      uid: 1000,
    },
    steps: [
      {
        name: "run_test",
        cmd: "npx vitest run repro-issue-42.test.ts",
        exitCode: overrides.exitCode ?? 1,
        stdoutSha256: "a".repeat(64),
        stderrSha256: "b".repeat(64),
        durationMs: 1234,
        stdoutTail: overrides.stdoutTail ?? "",
        stderrTail:
          overrides.stderrTail ?? "ParseError: unexpected end of input",
      },
    ],
    failureObserved: {
      kind: "exception" as const,
      matchAny: ["ParseError"],
      traceExcerptSha256: "c".repeat(64),
    },
    environmentStrategy: {
      preferred: "dockerfile" as const,
      detected: "dockerfile" as const,
      fallbacks: ["synth_dockerfile", "bootstrap"] as Array<
        "synth_dockerfile" | "bootstrap"
      >,
      notes: "Found Dockerfile at Dockerfile",
      attempted: "dockerfile" as const,
      imageUsed: "rb-sandbox:fixture",
    },
    totalDurationMs: 1234,
  };
}

describe("reproducer prompt", () => {
  it("builds the initial reproduction prompt with triage and repo context", () => {
    const prompt = buildReproducerUserPrompt({
      triage: sampleTriageArtifacts.typescriptVitestBug,
      repoContext: {
        languages: ["TypeScript"],
        testFramework: "vitest",
        defaultBranch: "main",
      },
      iteration: 1,
    });

    expect(prompt).toContain("Parser crash on empty YAML input");
    expect(prompt).toContain("Classification: bug (severity: high)");
    expect(prompt).toContain("Match patterns: ParseError, unexpected end of input");
    expect(prompt).toContain("Test framework: vitest");
    expect(prompt).toContain("## Iteration 1 of 6");
    expect(prompt).toContain("Generate the initial reproduction plan and artifact.");
  });

  it("includes runtime feedback on later iterations", () => {
    const prompt = buildReproducerUserPrompt({
      triage: sampleTriageArtifacts.typescriptVitestBug,
      repoContext: {
        languages: ["TypeScript"],
        defaultBranch: "main",
      },
      iteration: 2,
      previousFeedback: {
        exitCode: 1,
        stderrTail: "ModuleNotFoundError: parser",
        stdoutTail: "",
        failureAnalysis: "Import error - missing module or incorrect path",
      },
    });

    expect(prompt).toContain("## Iteration 2 of 6");
    expect(prompt).toContain("ModuleNotFoundError: parser");
    expect(prompt).toContain("Import error - missing module or incorrect path");
    expect(prompt).toContain(
      "Refine the reproduction artifact based on the runtime feedback above.",
    );
  });
});

describe("reproducer parser", () => {
  it("extracts both tool blocks from a Claude response", () => {
    const response = buildMessage(buildPlanToolOutput(), buildArtifactToolOutput());

    expect(extractReproPlanFromResponse(response)).toEqual(buildPlanToolOutput());
    expect(extractReproArtifactFromResponse(response)).toEqual(
      buildArtifactToolOutput(),
    );
  });

  it("builds and validates a repro plan artifact using the default base sha", () => {
    const artifact = buildReproPlanArtifact({
      runId: "run_repro_fixture",
      toolOutput: buildPlanToolOutput(),
      defaultBaseRevision: {
        ref: "refs/heads/main",
        sha: "deadbee",
      },
    });

    expect(artifact).toMatchObject({
      schema_version: "rb.repro_plan.v1",
      run_id: "run_repro_fixture",
      base_revision: {
        ref: "refs/heads/main",
        sha: "deadbee",
      },
      environment_strategy: {
        preferred: "dockerfile",
        detected: "dockerfile",
        fallbacks: ["synth_dockerfile", "bootstrap"],
      },
      commands: [
        { cwd: ".", cmd: "npm ci" },
        { cwd: "tests", cmd: "npx vitest run repro-issue-42.test.ts" },
      ],
    });
    expect(validateReproPlanArtifact(artifact)).toEqual({ valid: true });
  });

  it("builds and validates a repro run artifact from sandbox output", () => {
    const artifact = buildReproRunArtifact({
      runId: "run_repro_fixture",
      iteration: 2,
      sandboxResult: buildSandboxResult(),
      artifactContent: buildArtifactToolOutput().content,
    });

    expect(artifact).toMatchObject({
      schema_version: "rb.repro_run.v1",
      run_id: "run_repro_fixture",
      iteration: 2,
      duration_ms: 1234,
      artifact_content: buildArtifactToolOutput().content,
    });
    expect(validateReproRunArtifact(artifact)).toEqual({ valid: true });
  });

  it("builds a safe heredoc command even when the default delimiter appears in the file", () => {
    const command = buildArtifactWriteCommand({
      ...buildArtifactToolOutput(),
      content: `console.log("${"REPRO_EOF_MARKER"}");`,
    });

    expect(command).toContain("mkdir -p 'tests'");
    expect(command).toContain("REPRO_EOF_MARKER_1");
    expect(command).not.toContain("cat <<'REPRO_EOF_MARKER' >");
  });
});

describe("reproducer feedback analysis", () => {
  it("categorizes timeout, import, syntax, and no-signal failures", () => {
    expect(
      analyzeSandboxFailure(buildSandboxResult({ status: "timeout" })),
    ).toBe("Execution timed out");
    expect(
      analyzeSandboxFailure(
        buildSandboxResult({
          stderrTail: "ModuleNotFoundError: parser",
        }),
      ),
    ).toBe("Import error - missing module or incorrect path");
    expect(
      analyzeSandboxFailure(
        buildSandboxResult({
          stderrTail: "SyntaxError: Unexpected token",
        }),
      ),
    ).toBe("Syntax error in generated code");
    expect(
      analyzeSandboxFailure(
        buildSandboxResult({
          status: "success",
          exitCode: 0,
          stderrTail: "",
          stdoutTail: "all good",
        }),
      ),
    ).toBe("All commands succeeded - expected failure signal did not appear");
  });

  it("builds feedback from the failing step when later steps succeed", () => {
    const feedback = buildReproducerFeedback({
      ...buildSandboxResult(),
      steps: [
        {
          name: "run_test",
          cmd: "npx vitest run repro-issue-42.test.ts",
          exitCode: 1,
          stdoutSha256: "a".repeat(64),
          stderrSha256: "b".repeat(64),
          durationMs: 1234,
          stdoutTail: "",
          stderrTail: "ModuleNotFoundError: parser",
        },
        {
          name: "cleanup",
          cmd: "echo cleanup",
          exitCode: 0,
          stdoutSha256: "c".repeat(64),
          stderrSha256: "d".repeat(64),
          durationMs: 10,
          stdoutTail: "cleanup complete",
          stderrTail: "",
        },
      ],
    });

    expect(feedback).toEqual({
      exitCode: 1,
      stderrTail: "ModuleNotFoundError: parser",
      stdoutTail: "",
      failureAnalysis: "Import error - missing module or incorrect path",
    });
  });

  it("builds feedback and matches the expected failure signal", () => {
    const sandboxResult = buildSandboxResult({
      stderrTail: "ParseError: unexpected end of input",
    });
    const mismatchedSandboxResult = buildSandboxResult({
      stderrTail: "ReferenceError: nope",
    });
    const feedback = buildReproducerFeedback(sandboxResult);

    expect(feedback).toEqual({
      exitCode: 1,
      stderrTail: "ParseError: unexpected end of input",
      stdoutTail: "",
      failureAnalysis: "Command 'run_test' failed with exit code 1",
    });
    expect(
      matchesExpectedFailureSignal(
        sandboxResult,
        sandboxResult.steps[0],
        sampleTriageArtifacts.typescriptVitestBug.repro_hypothesis.expected_failure_signal,
      ),
    ).toBe(true);
    expect(
      matchesExpectedFailureSignal(
        mismatchedSandboxResult,
        mismatchedSandboxResult.steps[0],
        sampleTriageArtifacts.typescriptVitestBug.repro_hypothesis.expected_failure_signal,
      ),
    ).toBe(false);
  });
});
