import { describe, expect, it } from "vitest";

import {
  SCHEMA_VERSIONS,
  assertValidArtifact,
  isSchemaVersion,
  validateArtifact,
} from "../lib/schema-validator";

const validArtifacts = {
  "rb.triage.v1": {
    schema_version: "rb.triage.v1",
    run_id: "run_123",
    repo: {
      owner: "repo-butler",
      name: "example",
      default_branch: "main",
    },
    issue: {
      number: 42,
      title: "Parser crash",
      url: "https://github.com/repo-butler/example/issues/42",
    },
    classification: {
      type: "bug",
      area: ["parser"],
      severity: "high",
      labels_suggested: ["type:bug"],
      confidence: 0.92,
    },
    repro_hypothesis: {
      minimal_steps_guess: ["Run the parser against an empty file."],
      expected_failure_signal: {
        kind: "exception",
        match_any: ["ParseError"],
      },
    },
    repro_eligible: true,
    summary: "The parser crashes on empty input.",
  },
  "rb.repro_contract.v1": {
    schema_version: "rb.repro_contract.v1",
    run_id: "run_123",
    acceptance: {
      artifact_type: "test",
      must_fail_on_base_revision: true,
      must_be_deterministic: {
        reruns: 3,
        allowed_flake_rate: 0,
      },
      must_not_require_network: true,
      failure_signal: {
        kind: "assertion",
        stderr_match_any: ["expected false to be true"],
      },
    },
    sandbox_policy: {
      network: "disabled",
      run_as_root: false,
      secrets_mount: "none",
    },
    budgets: {
      wall_clock_seconds: 300,
      max_iterations: 3,
    },
  },
  "rb.repro_plan.v1": {
    schema_version: "rb.repro_plan.v1",
    run_id: "run_123",
    base_revision: {
      ref: "refs/heads/main",
      sha: "deadbee",
    },
    environment_strategy: {
      preferred: "dockerfile",
      detected: "dockerfile",
      fallbacks: ["synth_dockerfile", "bootstrap"],
      notes: "Use the repo Dockerfile first.",
      image_used: "rb-repro-123",
    },
    commands: [
      {
        cwd: "/workspace",
        cmd: "pnpm test",
      },
    ],
    artifact: {
      type: "test",
      path: "tests/repro.spec.ts",
      entrypoint: "tests/repro.spec.ts",
    },
  },
  "rb.repro_run.v1": {
    schema_version: "rb.repro_run.v1",
    run_id: "run_123",
    iteration: 1,
    sandbox: {
      kind: "docker",
      network: "disabled",
      uid: 1000,
    },
    steps: [
      {
        name: "run tests",
        cmd: "pnpm test",
        exit_code: 1,
        stderr_sha256: "a".repeat(64),
        duration_ms: 1234,
      },
    ],
    failure_observed: {
      kind: "assertion",
      match_any: ["expected false to be true"],
    },
    failure_type: "repro_failure",
    environment_strategy: {
      attempted: "dockerfile",
      detected: "dockerfile",
      image_used: "rb-repro-123",
    },
    artifact_content: "failing test body",
    duration_ms: 1234,
  },
  "rb.verification.v1": {
    schema_version: "rb.verification.v1",
    run_id: "run_123",
    verdict: "reproduced",
    determinism: {
      reruns: 3,
      fails: 3,
      flake_rate: 0,
    },
    policy_checks: {
      network_used: false,
      secrets_accessed: false,
      writes_outside_workspace: false,
    },
    evidence: {
      failing_cmd: "pnpm test",
      exit_code: 1,
      stderr_sha256: "b".repeat(64),
    },
    notes: "Deterministic failure confirmed.",
  },
} as const;

describe("validateArtifact", () => {
  it.each(SCHEMA_VERSIONS)("accepts a valid %s artifact", (schemaVersion) => {
    expect(
      validateArtifact(schemaVersion, validArtifacts[schemaVersion]),
    ).toEqual({
      valid: true,
    });
  });

  it("reports meaningful paths when required fields are missing", () => {
    const result = validateArtifact("rb.triage.v1", {
      schema_version: "rb.triage.v1",
    });

    expect(result.valid).toBe(false);
    if (result.valid) {
      throw new Error("Expected validation failure");
    }

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("/run_id"),
        expect.stringContaining("/repo"),
        expect.stringContaining("/issue"),
      ]),
    );
  });
});

describe("isSchemaVersion", () => {
  it("recognizes every supported schema version", () => {
    for (const schemaVersion of SCHEMA_VERSIONS) {
      expect(isSchemaVersion(schemaVersion)).toBe(true);
    }
  });

  it("rejects unknown schema version strings", () => {
    expect(isSchemaVersion("rb.unknown.v1")).toBe(false);
    expect(isSchemaVersion("triage")).toBe(false);
    expect(isSchemaVersion(null)).toBe(false);
  });
});

describe("assertValidArtifact", () => {
  it("returns void for valid artifacts", () => {
    expect(
      assertValidArtifact("rb.triage.v1", validArtifacts["rb.triage.v1"]),
    ).toBeUndefined();
  });

  it("throws for invalid artifacts", () => {
    expect(() =>
      assertValidArtifact("rb.triage.v1", {
        schema_version: "rb.triage.v1",
        run_id: "run_123",
      }),
    ).toThrowError(/Validation failed for rb\.triage\.v1/);
  });
});
