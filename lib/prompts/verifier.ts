import type { ReproContract } from "../generated/repro-contract.v1";
import { validateArtifact } from "../schema-validator";
import type { TriageArtifact } from "../triage-parser";

export type { ReproContract } from "../generated/repro-contract.v1";

export const DEFAULT_VERIFICATION_RERUNS = 3;
export const DEFAULT_ALLOWED_FLAKE_RATE = 0;
export const DEFAULT_VERIFICATION_TIMEOUT_SECONDS = 1200;
export const DEFAULT_VERIFICATION_MAX_ITERATIONS = 6;

export function generateReproContract(
  runId: string,
  triage: TriageArtifact,
): ReproContract {
  const signal = triage.repro_hypothesis.expected_failure_signal;

  return {
    schema_version: "rb.repro_contract.v1",
    run_id: runId,
    acceptance: {
      artifact_type: "test",
      must_fail_on_base_revision: true,
      must_be_deterministic: {
        reruns: DEFAULT_VERIFICATION_RERUNS,
        allowed_flake_rate: DEFAULT_ALLOWED_FLAKE_RATE,
      },
      must_not_require_network: true,
      failure_signal: {
        kind: signal.kind,
        ...(signal.match_any !== undefined
          ? { stderr_match_any: [...signal.match_any] }
          : {}),
      },
    },
    sandbox_policy: {
      network: "disabled",
      run_as_root: false,
      secrets_mount: "none",
    },
    budgets: {
      wall_clock_seconds: DEFAULT_VERIFICATION_TIMEOUT_SECONDS,
      max_iterations: DEFAULT_VERIFICATION_MAX_ITERATIONS,
    },
  };
}

export function validateReproContractArtifact(
  artifact: ReproContract,
): { valid: true } | { valid: false; errors: string[] } {
  return validateArtifact("rb.repro_contract.v1", artifact);
}

export function reproContractArtifactToMutationArgs<RunId extends string>(
  runId: RunId,
  artifact: ReproContract,
) {
  return {
    runId,
    schemaVersion: artifact.schema_version,
    acceptance: {
      artifactType: artifact.acceptance.artifact_type,
      mustFailOnBaseRevision: artifact.acceptance.must_fail_on_base_revision,
      mustBeDeterministic: {
        reruns: BigInt(artifact.acceptance.must_be_deterministic.reruns),
        allowedFlakeRate:
          artifact.acceptance.must_be_deterministic.allowed_flake_rate,
      },
      mustNotRequireNetwork: artifact.acceptance.must_not_require_network,
      failureSignal: {
        kind: artifact.acceptance.failure_signal.kind,
        ...(artifact.acceptance.failure_signal.stderr_match_any !== undefined
          ? {
              matchAny: [
                ...artifact.acceptance.failure_signal.stderr_match_any,
              ],
            }
          : {}),
      },
    },
    sandboxPolicy: {
      network: artifact.sandbox_policy.network,
      runAsRoot: artifact.sandbox_policy.run_as_root,
      secretsMount: artifact.sandbox_policy.secrets_mount,
    },
    budgets: {
      wallClockSeconds: BigInt(artifact.budgets.wall_clock_seconds),
      maxIterations: BigInt(artifact.budgets.max_iterations),
    },
  };
}
