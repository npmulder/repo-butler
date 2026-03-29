import type { Message } from "@anthropic-ai/sdk/resources/messages/messages";
import { describe, expect, it } from "vitest";

import type { TriageInput } from "../lib/claude";
import {
  TRIAGE_TOOL_NAME,
  buildTriageUserPrompt,
} from "../lib/prompts/triage";
import {
  buildTriageArtifact,
  extractTriageFromResponse,
  validateTriageArtifact,
  type TriageToolOutput,
} from "../lib/triage-parser";
import { sampleIssues } from "./fixtures/sample-issues";

function buildTriageInput(
  issue: (typeof sampleIssues)[keyof typeof sampleIssues],
): TriageInput {
  return {
    repo: {
      owner: "test",
      name: "repo",
      defaultBranch: "main",
    },
    issue: {
      number: issue.number,
      title: issue.title,
      body: issue.body,
      url: issue.url,
      author: issue.author,
      labels: [...issue.labels],
      createdAt: issue.createdAt,
    },
    repoContext: {
      languages: ["TypeScript"],
      hasTestFramework: true,
      testCommand: "pnpm test",
      readme: "Repo Butler reproduces repository issues with deterministic validation.",
    },
  };
}

function buildMessage(toolOutput: TriageToolOutput): Message {
  return {
    id: "msg_test_123",
    container: null,
    content: [
      { type: "text", text: "Preparing triage output." },
      {
        type: "tool_use",
        id: "toolu_test_123",
        name: TRIAGE_TOOL_NAME,
        input: toolOutput,
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
  } as unknown as Message;
}

const integrationCases: Array<
  [
    string,
    (typeof sampleIssues)[keyof typeof sampleIssues],
    TriageToolOutput,
  ]
> = [
  [
    "clearBug",
    sampleIssues.clearBug,
    {
      classification: {
        type: "bug",
        area: ["parser"],
        severity: "high",
        labels_suggested: ["type:bug", "severity:high", "area:parser"],
        confidence: 0.96,
      },
      repro_hypothesis: {
        minimal_steps_guess: [
          "Create an empty YAML file.",
          "Run the parser command against it.",
        ],
        expected_failure_signal: {
          kind: "exception",
          match_any: ["ParseError", "unexpected end of input"],
        },
        environment_assumptions: {
          os: "Ubuntu 22.04",
          runtime: "Node 20.x",
        },
      },
      repro_eligible: true,
      summary:
        "This is a high-confidence parser crash with explicit steps and an error trace. The failure should be reproducible in an automated sandbox.",
    },
  ],
  [
    "featureRequest",
    sampleIssues.featureRequest,
    {
      classification: {
        type: "feature",
        area: ["ui"],
        severity: "low",
        labels_suggested: ["type:feature", "area:ui"],
        confidence: 0.94,
      },
      repro_hypothesis: {
        expected_failure_signal: {
          kind: "nonzero_exit",
        },
      },
      repro_eligible: false,
      summary:
        "This is a feature request for new dark mode functionality rather than a bug report. It should not be sent to automated reproduction.",
    },
  ],
  [
    "ambiguousBug",
    sampleIssues.ambiguousBug,
    {
      classification: {
        type: "bug",
        area: ["api"],
        severity: "medium",
        labels_suggested: ["type:bug", "severity:medium", "area:api"],
        confidence: 0.53,
      },
      repro_hypothesis: {
        minimal_steps_guess: [
          "Exercise the API repeatedly until the intermittent failure appears.",
        ],
        expected_failure_signal: {
          kind: "nonzero_exit",
          match_any: ["error", "timeout", "5xx"],
        },
      },
      repro_eligible: true,
      summary:
        "The report is ambiguous but still plausibly points to an intermittent API bug. It remains eligible for automated reproduction because a CLI or integration harness could probe for a measurable failure.",
    },
  ],
  [
    "docsIssue",
    sampleIssues.docsIssue,
    {
      classification: {
        type: "docs",
        area: ["docs"],
        severity: "low",
        labels_suggested: ["type:docs", "area:docs"],
        confidence: 0.97,
      },
      repro_hypothesis: {
        expected_failure_signal: {
          kind: "nonzero_exit",
        },
      },
      repro_eligible: false,
      summary:
        "The report identifies outdated installation documentation after a package rename. It is a documentation issue and should bypass automated reproduction.",
    },
  ],
];

describe("triage parser", () => {
  it("extracts the submit_triage tool block from a Claude response", () => {
    const toolOutput: TriageToolOutput = {
      classification: {
        type: "bug",
        area: ["parser"],
        severity: "high",
        labels_suggested: ["type:bug", "severity:high", "area:parser"],
        confidence: 0.96,
      },
      repro_hypothesis: {
        minimal_steps_guess: [
          "Create an empty YAML file.",
          "Run the parse command against the file.",
        ],
        expected_failure_signal: {
          kind: "exception",
          match_any: ["ParseError", "unexpected end of input"],
        },
        environment_assumptions: {
          os: "Ubuntu 22.04",
          language: "TypeScript",
          runtime: "Node 20.x",
        },
      },
      repro_eligible: true,
      summary:
        "The report describes a deterministic parser crash on empty YAML input. It should be triaged as a high-severity bug because the current behavior is an unhandled exception.",
    };

    expect(extractTriageFromResponse(buildMessage(toolOutput))).toEqual(toolOutput);
  });

  it("builds a valid rb.triage.v1 artifact from structured tool output", () => {
    const input = buildTriageInput(sampleIssues.clearBug);
    const toolOutput: TriageToolOutput = {
      classification: {
        type: "bug",
        area: ["parser"],
        severity: "high",
        labels_suggested: ["type:bug", "severity:high", "area:parser"],
        confidence: 0.96,
      },
      repro_hypothesis: {
        minimal_steps_guess: [
          "Create an empty YAML file.",
          "Run the parse command against the file.",
        ],
        expected_failure_signal: {
          kind: "exception",
          match_any: ["ParseError", "unexpected end of input"],
        },
      },
      repro_eligible: true,
      summary:
        "The issue contains concrete reproduction steps and a parser stack trace. It is a high-confidence bug report that should be eligible for automated reproduction.",
    };

    const artifact = buildTriageArtifact(
      "2026-03-25T10:00:00.000Z_test_repo_42",
      input,
      toolOutput,
    );

    expect(artifact).toMatchObject({
      schema_version: "rb.triage.v1",
      run_id: "2026-03-25T10:00:00.000Z_test_repo_42",
      issue: {
        number: 42,
        title: sampleIssues.clearBug.title,
        url: sampleIssues.clearBug.url,
      },
      summary: toolOutput.summary,
    });
    expect(validateTriageArtifact(artifact)).toEqual({ valid: true });
  });

  it("rejects invalid triage artifacts", () => {
    const input = buildTriageInput(sampleIssues.clearBug);
    const artifact = buildTriageArtifact("run_42", input, {
      classification: {
        type: "bug",
        labels_suggested: ["type:bug"],
        confidence: 0.8,
      },
      repro_hypothesis: {
        expected_failure_signal: {
          kind: "exception",
        },
      },
      repro_eligible: true,
      summary: "Valid summary.",
    });

    const invalidArtifact = {
      ...artifact,
      classification: {
        ...artifact.classification,
        labels_suggested: [],
        confidence: 1.5,
      },
    } as unknown as typeof artifact;

    const result = validateTriageArtifact(invalidArtifact);

    expect(result.valid).toBe(false);
    if (result.valid) {
      throw new Error("Expected validation to fail");
    }
    expect(result.errors.join("\n")).toContain("/classification/labels_suggested");
    expect(result.errors.join("\n")).toContain("/classification/confidence");
  });

  it("builds prompts with repository and issue context", () => {
    const prompt = buildTriageUserPrompt(buildTriageInput(sampleIssues.docsIssue));

    expect(prompt).toContain("## Repository: test/repo");
    expect(prompt).toContain("Default branch: main");
    expect(prompt).toContain(sampleIssues.docsIssue.title);
    expect(prompt).toContain(sampleIssues.docsIssue.body);
    expect(prompt).toContain("Existing labels: documentation");
    expect(prompt).toContain("Test command: pnpm test");
    expect(prompt).toContain("README Excerpt");
  });

  it("truncates issue bodies longer than 8000 characters", () => {
    const input = buildTriageInput(sampleIssues.clearBug);
    input.issue.body = "x".repeat(8100);

    const prompt = buildTriageUserPrompt(input);

    expect(prompt).toContain("[truncated after 8000 characters]");
    expect(prompt).not.toContain("x".repeat(8050));
  });

  it("truncates readme excerpts longer than 4000 characters", () => {
    const input = buildTriageInput(sampleIssues.clearBug);
    input.repoContext!.readme = "r".repeat(4100);

    const prompt = buildTriageUserPrompt(input);

    expect(prompt).toContain("[truncated after 4000 characters]");
    expect(prompt).not.toContain("r".repeat(4050));
  });

  it("renders empty issue bodies explicitly", () => {
    const input = buildTriageInput(sampleIssues.clearBug);
    input.issue.body = "   ";

    const prompt = buildTriageUserPrompt(input);

    expect(prompt).toContain("### Issue Body\n\n(empty)");
  });

  it("omits repository context when repoContext is missing", () => {
    const input = buildTriageInput(sampleIssues.clearBug);
    delete input.repoContext;

    const prompt = buildTriageUserPrompt(input);

    expect(prompt).not.toContain("## Repository Context");
    expect(prompt).not.toContain("README Excerpt");
    expect(prompt).toContain("## Issue #42");
  });

  it.each(integrationCases)(
    "parses mocked Claude output and validates the artifact for %s",
    (_name, issue, toolOutput) => {
      const input = buildTriageInput(issue);
      const extracted = extractTriageFromResponse(buildMessage(toolOutput));

      expect(extracted).not.toBeNull();

      const artifact = buildTriageArtifact(`run_${issue.number}`, input, extracted!);
      expect(validateTriageArtifact(artifact)).toEqual({ valid: true });
      expect(artifact.issue.number).toBe(issue.number);
      expect(artifact.summary).toBe(toolOutput.summary);
      expect(artifact.repro_eligible).toBe(toolOutput.repro_eligible);
    },
  );
});
