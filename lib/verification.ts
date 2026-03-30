import type { ReproContract } from "./prompts/verifier";
import type { Verification } from "./generated/verification.v1";
import { validateArtifact } from "./schema-validator";
import type { SandboxResult, StepResult } from "../worker/types";

export type { Verification } from "./generated/verification.v1";

function buildEvidence(
  result: SandboxResult,
  step: StepResult | undefined,
  fallbackPath: string,
): Verification["evidence"] {
  return {
    failing_cmd: step?.cmd ?? `artifact:${fallbackPath}`,
    exit_code:
      step?.exitCode ?? (result.status === "timeout" ? 124 : 0),
    ...(step?.stderrSha256 ? { stderr_sha256: step.stderrSha256 } : {}),
  };
}

function findVerificationStep(result: SandboxResult): StepResult | undefined {
  const candidateSteps = result.steps.filter((step) => step.name !== "write_artifact");

  const namedTestStep = [...candidateSteps]
    .reverse()
    .find((step) => step.name === "run_test");

  if (namedTestStep) {
    return namedTestStep;
  }

  const frameworkStep = [...candidateSteps].reverse().find((step) =>
    /(pytest|vitest|jest|go test|npm test|pnpm test|yarn test)/.test(step.cmd),
  );

  if (frameworkStep) {
    return frameworkStep;
  }

  return (
    [...candidateSteps].reverse().find((step) => step.exitCode !== 0) ??
    candidateSteps[candidateSteps.length - 1] ??
    result.steps[result.steps.length - 1]
  );
}

function buildPolicyChecks(rerunResults: SandboxResult[]) {
  return {
    network_used: rerunResults.some((result) => result.sandbox.network === "enabled"),
    secrets_accessed: false,
    writes_outside_workspace: false,
    ran_as_root: rerunResults.some((result) => result.sandbox.uid === 0),
  } as const;
}

function matchesContractFailureSignal(
  contract: ReproContract,
  result: SandboxResult,
  step: StepResult | undefined,
): boolean {
  if (contract.acceptance.failure_signal.kind === "timeout") {
    return result.status === "timeout";
  }

  if (!step || step.exitCode === 0) {
    return false;
  }

  const patterns = contract.acceptance.failure_signal.stderr_match_any ?? [];

  if (patterns.length === 0) {
    return true;
  }

  const haystack = `${step.stderrTail ?? ""}\n${step.stdoutTail ?? ""}`;
  return patterns.some((pattern) => haystack.includes(pattern));
}

export function verifyReproduction(
  contract: ReproContract,
  rerunResults: SandboxResult[],
  reproArtifact: { file_path: string; content: string },
): Verification {
  if (rerunResults.length === 0) {
    throw new Error("Verification requires at least one rerun result");
  }

  const policyChecks = buildPolicyChecks(rerunResults);
  const fallbackResult = rerunResults[0];
  const fallbackStep = fallbackResult
    ? findVerificationStep(fallbackResult)
    : undefined;
  const fallbackEvidence = buildEvidence(
    fallbackResult,
    fallbackStep,
    reproArtifact.file_path,
  );

  if (
    contract.acceptance.must_not_require_network &&
    policyChecks.network_used
  ) {
    return {
      schema_version: "rb.verification.v1",
      run_id: contract.run_id,
      verdict: "policy_violation",
      determinism: {
        reruns: rerunResults.length,
        fails: 0,
        flake_rate: 1,
      },
      policy_checks: policyChecks,
      evidence: fallbackEvidence,
      notes: "Network was enabled during verification despite a no-network contract.",
    };
  }

  if (!contract.sandbox_policy.run_as_root && policyChecks.ran_as_root) {
    return {
      schema_version: "rb.verification.v1",
      run_id: contract.run_id,
      verdict: "policy_violation",
      determinism: {
        reruns: rerunResults.length,
        fails: 0,
        flake_rate: 1,
      },
      policy_checks: policyChecks,
      evidence: fallbackEvidence,
      notes: "Verification sandbox ran as root, violating the sandbox policy.",
    };
  }

  let failCount = 0;
  let lastEvidence = fallbackEvidence;

  for (const result of rerunResults) {
    const step = findVerificationStep(result);

    if (matchesContractFailureSignal(contract, result, step)) {
      failCount += 1;
      lastEvidence = buildEvidence(result, step, reproArtifact.file_path);
    }
  }

  const flakeRate = 1 - failCount / rerunResults.length;
  const allowedFlakeRate =
    contract.acceptance.must_be_deterministic.allowed_flake_rate;

  let verdict: Verification["verdict"];
  let notes: string;

  if (failCount === rerunResults.length) {
    verdict = "reproduced";
    notes = `Reproduction failed with the expected signal in ${failCount}/${rerunResults.length} reruns.`;
  } else if (failCount === 0) {
    verdict = "not_reproduced";
    notes = `Reproduction did not fail with the expected signal in any of ${rerunResults.length} reruns.`;
  } else if (flakeRate <= allowedFlakeRate) {
    verdict = "reproduced";
    notes = `Observed ${failCount}/${rerunResults.length} matching failures; flake rate ${(flakeRate * 100).toFixed(1)}% is within the allowed tolerance.`;
  } else {
    verdict = "flaky";
    notes = `Observed ${failCount}/${rerunResults.length} matching failures; flake rate ${(flakeRate * 100).toFixed(1)}% exceeds the allowed tolerance.`;
  }

  return {
    schema_version: "rb.verification.v1",
    run_id: contract.run_id,
    verdict,
    determinism: {
      reruns: rerunResults.length,
      fails: failCount,
      flake_rate: flakeRate,
    },
    policy_checks: policyChecks,
    evidence: lastEvidence,
    notes,
  };
}

export function validateVerificationArtifact(
  artifact: Verification,
): { valid: true } | { valid: false; errors: string[] } {
  return validateArtifact("rb.verification.v1", artifact);
}

export function verificationArtifactToMutationArgs<RunId extends string>(
  runId: RunId,
  artifact: Verification,
) {
  return {
    runId,
    schemaVersion: artifact.schema_version,
    verdict: artifact.verdict,
    determinism: {
      reruns: BigInt(artifact.determinism.reruns),
      fails: BigInt(artifact.determinism.fails),
      flakeRate: artifact.determinism.flake_rate,
    },
    policyChecks: {
      networkUsed: artifact.policy_checks.network_used,
      secretsAccessed: artifact.policy_checks.secrets_accessed,
      writesOutsideWorkspace: artifact.policy_checks.writes_outside_workspace,
      ranAsRoot: artifact.policy_checks.ran_as_root,
    },
    evidence: {
      failingCmd: artifact.evidence.failing_cmd,
      exitCode: BigInt(artifact.evidence.exit_code),
      ...(artifact.evidence.stderr_sha256
        ? { stderrSha256: artifact.evidence.stderr_sha256 }
        : {}),
    },
    ...(artifact.notes !== undefined ? { notes: artifact.notes } : {}),
  };
}
