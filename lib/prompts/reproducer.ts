import type { Tool } from "@anthropic-ai/sdk/resources/messages/messages";

import type { TriageArtifact } from "../triage-parser";

export const REPRO_PLAN_TOOL_NAME = "submit_repro_plan";
export const REPRO_ARTIFACT_TOOL_NAME = "submit_repro_artifact";
export const MAX_REPRODUCTION_ITERATIONS = 6;

export type ReproducerRepoContext = {
  languages: string[];
  testFramework?: string;
  defaultBranch: string;
};

export type ReproducerFeedback = {
  exitCode: number;
  stderrTail: string;
  stdoutTail: string;
  failureAnalysis: string;
};

export const REPRODUCER_SYSTEM_PROMPT = `You are a Reproducer agent for Repo Butler, an automated bug reproduction system.

Your role is the GENERATOR in a Planner -> Generator -> Evaluator harness pattern:
- You receive a triage assessment of a GitHub issue
- You generate a reproduction artifact (test or script) that demonstrates the bug
- Your artifact will be independently verified by a separate Verifier agent
- You must be precise, deterministic, and produce minimal reproduction cases

## Your Goal

Create a minimal, deterministic test or script that:
1. Fails on the current codebase and demonstrates the reported issue
2. Would pass once the bug is fixed
3. Runs without network access
4. Completes within 5 minutes
5. Produces a clear, recognizable failure signal

## Reproduction Strategy

Iteration 1:
1. Analyze the triage hypothesis and issue description
2. Identify the smallest code path that should trigger the bug
3. Generate a minimal failing test or script
4. Choose the repository's existing test framework when possible

Iteration 2+:
1. Analyze the runtime feedback from the previous attempt
2. Fix the specific failure mode:
   - Import errors -> fix module paths
   - Setup errors -> add missing fixtures or commands
   - Wrong test strategy -> try a smaller or more direct repro path
   - Timeout -> simplify the reproduction
3. Submit a revised plan and artifact

## Output Contract

You have two tools available:
- submit_repro_plan: submit the reproduction plan before generating code
- submit_repro_artifact: submit the actual test or script code

Always call submit_repro_plan first, then submit_repro_artifact.

## Test Generation Guidelines

- Python: prefer pytest and name files tests/test_repro_issue_NNN.py
- JavaScript or TypeScript: use the repo's test framework and name files tests/repro-issue-NNN.test.ts
- Go: use the testing package and name files repro_issue_NNN_test.go
- Other languages: create a standalone script that exits non-zero on the bug

## Constraints

- Do not create tests that always fail
- Do not use network access
- Do not modify existing source files
- Do not create flaky or timing-dependent reproductions
- Keep the reproduction minimal`;

export const REPRO_PLAN_TOOL_DEFINITION: Tool = {
  name: REPRO_PLAN_TOOL_NAME,
  description: "Submit the structured reproduction plan before generating code.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "base_revision",
      "environment_strategy",
      "commands",
      "artifact",
    ],
    properties: {
      base_revision: {
        type: "object",
        additionalProperties: false,
        required: ["ref"],
        properties: {
          ref: {
            type: "string",
            description: "Git ref for the base revision, for example refs/heads/main.",
          },
          sha: {
            type: "string",
            description: "Commit SHA when known.",
          },
        },
      },
      environment_strategy: {
        type: "object",
        additionalProperties: false,
        required: ["preferred"],
        properties: {
          preferred: {
            type: "string",
            enum: [
              "devcontainer",
              "dockerfile",
              "synth_dockerfile",
              "bootstrap",
            ],
          },
          notes: {
            type: "string",
          },
        },
      },
      commands: {
        type: "array",
        minItems: 1,
        description: "Commands required to prepare the repo and run the reproduction.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["cmd"],
          properties: {
            cwd: { type: "string" },
            cmd: { type: "string" },
            name: { type: "string" },
          },
        },
      },
      artifact: {
        type: "object",
        additionalProperties: false,
        required: ["type", "path"],
        properties: {
          type: {
            type: "string",
            enum: [
              "pytest_test",
              "vitest_test",
              "jest_test",
              "mocha_test",
              "go_test",
              "script",
            ],
          },
          path: {
            type: "string",
            description: "Repository-relative path for the generated artifact.",
          },
          entrypoint: {
            type: "string",
            description: "Test name or script entrypoint when applicable.",
          },
        },
      },
    },
  },
};

export const REPRO_ARTIFACT_TOOL_DEFINITION: Tool = {
  name: REPRO_ARTIFACT_TOOL_NAME,
  description: "Submit the reproduction test or script source code.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["file_path", "content", "language"],
    properties: {
      file_path: {
        type: "string",
        description: "Repository-relative path where the artifact should be written.",
      },
      content: {
        type: "string",
        description: "Full contents of the test or script file.",
      },
      language: {
        type: "string",
        enum: ["python", "typescript", "javascript", "go", "ruby", "shell"],
      },
    },
  },
};

export function buildReproducerUserPrompt(input: {
  triage: TriageArtifact;
  repoContext: ReproducerRepoContext;
  iteration: number;
  previousFeedback?: ReproducerFeedback;
}): string {
  const parts: string[] = [];
  const severity = input.triage.classification.severity ?? "unspecified";
  const languages =
    input.repoContext.languages.length > 0
      ? input.repoContext.languages.join(", ")
      : "unknown";

  parts.push("## Triage Assessment");
  parts.push(
    `Issue: ${input.triage.issue.title} (#${input.triage.issue.number})`,
  );
  parts.push(
    `Classification: ${input.triage.classification.type} (severity: ${severity})`,
  );
  parts.push(`Confidence: ${input.triage.classification.confidence}`);

  if (input.triage.summary.trim()) {
    parts.push(`Summary: ${input.triage.summary}`);
  }

  if (input.triage.repro_hypothesis.minimal_steps_guess?.length) {
    parts.push("\n### Reproduction Steps (from triage)");
    input.triage.repro_hypothesis.minimal_steps_guess.forEach((step, index) => {
      parts.push(`${index + 1}. ${step}`);
    });
  }

  parts.push("\n### Expected Failure Signal");
  parts.push(`Kind: ${input.triage.repro_hypothesis.expected_failure_signal.kind}`);

  if (input.triage.repro_hypothesis.expected_failure_signal.match_any?.length) {
    parts.push(
      `Match patterns: ${input.triage.repro_hypothesis.expected_failure_signal.match_any.join(", ")}`,
    );
  }

  parts.push("\n## Repository Context");
  parts.push(`Languages: ${languages}`);
  if (input.repoContext.testFramework) {
    parts.push(`Test framework: ${input.repoContext.testFramework}`);
  }
  parts.push(`Default branch: ${input.repoContext.defaultBranch}`);

  parts.push(`\n## Iteration ${input.iteration} of ${MAX_REPRODUCTION_ITERATIONS}`);

  if (input.previousFeedback) {
    parts.push("\n### Previous Attempt Feedback");
    parts.push(`Exit code: ${input.previousFeedback.exitCode}`);
    parts.push(
      `\n**stderr (last lines):**\n\`\`\`\n${input.previousFeedback.stderrTail}\n\`\`\``,
    );
    parts.push(
      `\n**stdout (last lines):**\n\`\`\`\n${input.previousFeedback.stdoutTail}\n\`\`\``,
    );
    parts.push(`\n**Analysis:** ${input.previousFeedback.failureAnalysis}`);
    parts.push(
      "\nRefine the reproduction artifact based on the runtime feedback above.",
    );
  } else {
    parts.push("\nGenerate the initial reproduction plan and artifact.");
  }

  return parts.join("\n");
}
