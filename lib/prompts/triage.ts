import type { Tool } from "@anthropic-ai/sdk/resources/messages/messages";

import type { TriageInput } from "../claude";

const MAX_ISSUE_BODY_CHARS = 8000;
const MAX_README_CHARS = 4000;

export const TRIAGE_TOOL_NAME = "submit_triage";

export const TRIAGE_SYSTEM_PROMPT = `You are a Triager agent for an open-source repository maintenance system called Repo Butler.

Your role is the PLANNER in a Planner -> Generator -> Evaluator harness pattern:
- You analyze GitHub issues and produce structured triage assessments
- Your output feeds into downstream agents (Reproducer and Verifier)
- You must be precise, conservative, and evidence-based

## Your Responsibilities

1. Classify the issue type: bug, docs, question, feature, build, or test
2. Assess severity: low, medium, high, or critical
3. Identify affected areas of the codebase (for example parser, auth, api, or ui)
4. Suggest labels following the repository taxonomy
5. Generate a reproduction hypothesis with:
   - minimal steps to reproduce
   - the expected failure signal
   - match patterns for stderr/stdout when they can be inferred
   - environment assumptions such as OS, language, and runtime version
6. Determine repro eligibility for an automated sandbox

## Classification Guidelines

- bug: Something that should work but does not, with observable incorrect behavior
- feature: A request for new functionality that does not exist yet
- docs: Missing, incorrect, or unclear documentation
- question: A request for help or clarification rather than a defect report
- build: Build system, CI, dependency, or packaging issues
- test: Test infrastructure, flakiness, or missing test coverage

## Severity Guidelines

- critical: Data loss, security vulnerability, or complete feature breakage for all users
- high: Major feature broken for a significant subset of users, with no practical workaround
- medium: Feature partially broken, workaround exists, or impact is limited
- low: Cosmetic issue, minor inconvenience, or narrow edge case

## Confidence Scoring

Use confidence from 0.0 to 1.0:
- 0.9 to 1.0: Clear bug report with convincing evidence and reproduction details
- 0.7 to 0.89: Likely correct classification with moderate ambiguity
- 0.5 to 0.69: Plausible classification but incomplete or ambiguous report
- 0.3 to 0.49: Unclear report that may reflect user error or a feature request
- 0.0 to 0.29: Very unlikely to be a reproducible product issue

## Repro Eligibility Rules

Mark repro_eligible false when:
- The issue type is question, feature, or docs
- The issue depends on special hardware, paid services, or manual UI-only interaction
- The issue is about performance without concrete thresholds
- Confidence is below 0.4
- The issue explicitly states that it cannot be reproduced

Mark repro_eligible true when:
- The issue type is bug, build, or test
- The reproduction can be observed in a CLI or automated test environment
- Steps are present or can be conservatively inferred
- Confidence is at least 0.4

Return the final answer only by calling the submit_triage tool exactly once.`;

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars).trimEnd()}\n\n[truncated after ${maxChars} characters]`;
}

function formatOptionalBlock(header: string, value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return [`\n## ${header}`, value];
}

export function buildTriageUserPrompt(input: TriageInput): string {
  const parts: string[] = [];

  parts.push(`## Repository: ${input.repo.owner}/${input.repo.name}`);
  parts.push(`Default branch: ${input.repo.defaultBranch}`);

  if (input.repoContext) {
    parts.push("\n## Repository Context");
    parts.push(
      `Languages: ${
        input.repoContext.languages.length > 0
          ? input.repoContext.languages.join(", ")
          : "unknown"
      }`,
    );
    parts.push(`Has test framework: ${input.repoContext.hasTestFramework}`);

    if (input.repoContext.testCommand) {
      parts.push(`Test command: ${input.repoContext.testCommand}`);
    }

    parts.push(
      ...formatOptionalBlock(
        "README Excerpt",
        input.repoContext.readme
          ? truncateText(input.repoContext.readme, MAX_README_CHARS)
          : undefined,
      ),
    );
  }

  parts.push(`\n## Issue #${input.issue.number}: ${input.issue.title}`);
  parts.push(`Author: ${input.issue.author}`);
  parts.push(`Created: ${input.issue.createdAt}`);

  if (input.issue.labels.length > 0) {
    parts.push(`Existing labels: ${input.issue.labels.join(", ")}`);
  }

  const issueBody = input.issue.body.trim()
    ? truncateText(input.issue.body, MAX_ISSUE_BODY_CHARS)
    : "(empty)";
  parts.push(`\n### Issue Body\n\n${issueBody}`);
  parts.push(
    `\nAnalyze this issue and call ${TRIAGE_TOOL_NAME} with the structured triage assessment.`,
  );

  return parts.join("\n");
}

export const TRIAGE_TOOL_DEFINITION: Tool = {
  name: TRIAGE_TOOL_NAME,
  description: "Submit the structured triage assessment for this GitHub issue.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "classification",
      "repro_hypothesis",
      "repro_eligible",
      "summary",
    ],
    properties: {
      classification: {
        type: "object",
        additionalProperties: false,
        required: ["type", "labels_suggested", "confidence"],
        properties: {
          type: {
            type: "string",
            enum: ["bug", "docs", "question", "feature", "build", "test"],
          },
          area: {
            type: "array",
            items: { type: "string" },
            description: "Affected areas of the codebase.",
          },
          severity: {
            type: "string",
            enum: ["low", "medium", "high", "critical"],
          },
          labels_suggested: {
            type: "array",
            minItems: 1,
            items: { type: "string" },
            description:
              "Repository labels to apply, for example type:bug, severity:high, or area:parser.",
          },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
          },
        },
      },
      repro_hypothesis: {
        type: "object",
        additionalProperties: false,
        required: ["expected_failure_signal"],
        properties: {
          minimal_steps_guess: {
            type: "array",
            items: { type: "string" },
            description: "Ordered minimal steps that would likely reproduce the issue.",
          },
          expected_failure_signal: {
            type: "object",
            additionalProperties: false,
            required: ["kind"],
            properties: {
              kind: {
                type: "string",
                enum: [
                  "exception",
                  "assertion",
                  "nonzero_exit",
                  "snapshot_diff",
                  "timeout",
                ],
              },
              match_any: {
                type: "array",
                items: { type: "string" },
                description: "Patterns that would indicate the expected failure.",
              },
            },
          },
          environment_assumptions: {
            type: "object",
            additionalProperties: false,
            properties: {
              os: { type: "string" },
              language: { type: "string" },
              runtime: { type: "string" },
            },
          },
        },
      },
      repro_eligible: {
        type: "boolean",
        description: "Whether this issue is eligible for automated reproduction.",
      },
      summary: {
        type: "string",
        minLength: 1,
        description:
          "A concise 2-3 sentence summary for maintainers explaining the triage decision.",
      },
    },
  },
};
