import { describe, expect, it } from "vitest";

import { sampleTriageArtifacts } from "./fixtures/sample-triage";
import {
  generateReproContract,
  validateReproContractArtifact,
} from "../lib/prompts/verifier";
import {
  validateVerificationArtifact,
  verifyReproduction,
} from "../lib/verification";

function buildSandboxResult(
  overrides: Partial<{
    status: "success" | "failure" | "error" | "timeout";
    exitCode: number;
    stderrTail: string;
    stdoutTail: string;
    network: "disabled" | "enabled";
    uid: number;
  }> = {},
) {
  const status = overrides.status ?? "failure";

  return {
    runId: "run_verify_fixture",
    status,
    ...(status === "success"
      ? {}
      : { failureType: "repro_failure" as const }),
    sandbox: {
      kind: "docker" as const,
      imageDigest: "sha256:verify",
      network: overrides.network ?? "disabled",
      uid: overrides.uid ?? 1000,
    },
    steps: [
      {
        name: "run_test",
        cmd: "pnpm test -- tests/repro-issue-42.test.ts",
        exitCode:
          overrides.exitCode ??
          (status === "timeout" ? 124 : status === "success" ? 0 : 1),
        stdoutSha256: "a".repeat(64),
        stderrSha256: "b".repeat(64),
        durationMs: 1234,
        stdoutTail: overrides.stdoutTail ?? "",
        stderrTail:
          overrides.stderrTail ?? "ParseError: unexpected end of input",
      },
    ],
    ...(status === "timeout"
      ? {
          failureObserved: {
            kind: "timeout" as const,
            traceExcerptSha256: "c".repeat(64),
          },
        }
      : status === "success"
        ? {}
        : {
            failureObserved: {
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
      notes: "Verifier fixture",
      attempted: "dockerfile" as const,
      imageUsed: "rb-sandbox:verify",
    },
    totalDurationMs: 1234,
  };
}

function buildContract() {
  return generateReproContract(
    "run_verify_fixture",
    sampleTriageArtifacts.typescriptVitestBug,
  );
}

describe("generateReproContract", () => {
  it("produces a valid rb.repro_contract.v1 artifact", () => {
    const contract = buildContract();

    expect(contract).toMatchObject({
      schema_version: "rb.repro_contract.v1",
      run_id: "run_verify_fixture",
      acceptance: {
        artifact_type: "test",
        must_fail_on_base_revision: true,
        must_be_deterministic: {
          reruns: 3,
          allowed_flake_rate: 0,
        },
        must_not_require_network: true,
        failure_signal: {
          kind: "exception",
          stderr_match_any: ["ParseError", "unexpected end of input"],
        },
      },
      sandbox_policy: {
        network: "disabled",
        run_as_root: false,
        secrets_mount: "none",
      },
      budgets: {
        wall_clock_seconds: 1200,
        max_iterations: 6,
      },
    });
    expect(validateReproContractArtifact(contract)).toEqual({ valid: true });
  });
});

describe("verifyReproduction", () => {
  it("returns reproduced when all reruns fail with the expected signal", () => {
    const verification = verifyReproduction(
      buildContract(),
      [
        buildSandboxResult(),
        buildSandboxResult(),
        buildSandboxResult(),
      ],
      {
        file_path: "tests/repro-issue-42.test.ts",
        content: "throw new Error('ParseError')",
      },
    );

    expect(verification).toMatchObject({
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
        ran_as_root: false,
      },
      evidence: {
        failing_cmd: "pnpm test -- tests/repro-issue-42.test.ts",
        exit_code: 1,
      },
    });
    expect(validateVerificationArtifact(verification)).toEqual({ valid: true });
  });

  it("returns flaky with the correct flake rate when only some reruns match", () => {
    const verification = verifyReproduction(
      buildContract(),
      [
        buildSandboxResult(),
        buildSandboxResult({
          status: "success",
          exitCode: 0,
          stderrTail: "",
          stdoutTail: "all tests passed",
        }),
        buildSandboxResult(),
      ],
      {
        file_path: "tests/repro-issue-42.test.ts",
        content: "throw new Error('ParseError')",
      },
    );

    expect(verification.verdict).toBe("flaky");
    expect(verification.determinism.reruns).toBe(3);
    expect(verification.determinism.fails).toBe(2);
    expect(verification.determinism.flake_rate).toBeCloseTo(1 / 3);
    expect(validateVerificationArtifact(verification)).toEqual({ valid: true });
  });

  it("returns not_reproduced when no rerun matches the expected failure", () => {
    const verification = verifyReproduction(
      buildContract(),
      [
        buildSandboxResult({
          status: "success",
          exitCode: 0,
          stderrTail: "",
          stdoutTail: "all tests passed",
        }),
        buildSandboxResult({
          status: "success",
          exitCode: 0,
          stderrTail: "",
          stdoutTail: "all tests passed",
        }),
        buildSandboxResult({
          status: "success",
          exitCode: 0,
          stderrTail: "",
          stdoutTail: "all tests passed",
        }),
      ],
      {
        file_path: "tests/repro-issue-42.test.ts",
        content: "throw new Error('ParseError')",
      },
    );

    expect(verification.verdict).toBe("not_reproduced");
    expect(verification.determinism).toMatchObject({
      reruns: 3,
      fails: 0,
      flake_rate: 1,
    });
  });

  it("returns policy_violation when the sandbox metadata shows network access", () => {
    const verification = verifyReproduction(
      buildContract(),
      [buildSandboxResult({ network: "enabled" })],
      {
        file_path: "tests/repro-issue-42.test.ts",
        content: "throw new Error('ParseError')",
      },
    );

    expect(verification.verdict).toBe("policy_violation");
    expect(verification.policy_checks.network_used).toBe(true);
  });

  it("returns policy_violation when the sandbox metadata shows root execution", () => {
    const verification = verifyReproduction(
      buildContract(),
      [buildSandboxResult({ uid: 0 })],
      {
        file_path: "tests/repro-issue-42.test.ts",
        content: "throw new Error('ParseError')",
      },
    );

    expect(verification.verdict).toBe("policy_violation");
    expect(verification.policy_checks.ran_as_root).toBe(true);
  });

  it("counts stderr match patterns when the expected text appears in output", () => {
    const verification = verifyReproduction(
      buildContract(),
      [
        buildSandboxResult({
          stderrTail: "Unhandled exception: ParseError while reading fixture",
        }),
      ],
      {
        file_path: "tests/repro-issue-42.test.ts",
        content: "throw new Error('ParseError')",
      },
    );

    expect(verification.verdict).toBe("reproduced");
    expect(verification.determinism.fails).toBe(1);
  });

  it("treats any non-zero exit as matching when no match patterns are present", () => {
    const contract = buildContract();
    contract.acceptance.failure_signal.stderr_match_any = [];

    const verification = verifyReproduction(
      contract,
      [
        buildSandboxResult({
          stderrTail: "Some unrelated failure text",
        }),
      ],
      {
        file_path: "tests/repro-issue-42.test.ts",
        content: "throw new Error('ParseError')",
      },
    );

    expect(verification.verdict).toBe("reproduced");
    expect(verification.determinism.fails).toBe(1);
  });
});
