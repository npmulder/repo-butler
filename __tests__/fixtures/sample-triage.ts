import type { TriageArtifact } from "../../lib/triage-parser";

export const sampleTriageArtifacts = {
  typescriptVitestBug: {
    schema_version: "rb.triage.v1",
    run_id: "run_repro_fixture",
    repo: {
      owner: "repo-butler",
      name: "example",
      default_branch: "main",
    },
    issue: {
      number: 42,
      title: "Parser crash on empty YAML input",
      url: "https://github.com/repo-butler/example/issues/42",
    },
    classification: {
      type: "bug",
      area: ["parser"],
      severity: "high",
      labels_suggested: ["type:bug", "area:parser", "severity:high"],
      confidence: 0.94,
    },
    repro_hypothesis: {
      minimal_steps_guess: [
        "Create an empty YAML fixture.",
        "Run the parser on that fixture through the existing test harness.",
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
      "The parser crashes on empty YAML input with a deterministic exception and should be reproducible with a minimal vitest case.",
  } satisfies TriageArtifact,
} as const;
