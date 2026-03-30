export type SandboxNetworkPolicy = "disabled" | "enabled";
export type SandboxEnvironmentStrategy =
  | "devcontainer"
  | "dockerfile"
  | "synth_dockerfile"
  | "bootstrap";
export type SandboxStatus = "success" | "failure" | "error" | "timeout";
export type SandboxFailureType = "env_setup" | "repro_failure";

export interface SandboxCommand {
  name: string;
  cmd: string;
  cwd?: string;
  timeout?: number;
}

export interface SandboxRequest {
  runId: string;
  repo: {
    cloneUrl: string;
    ref: string;
    sha: string;
  };
  environment: {
    strategy?: SandboxEnvironmentStrategy;
    dockerfilePath?: string;
    devcontainerPath?: string;
    bootstrapCommands?: string[];
    languageHint?: string;
    runtimeHint?: string;
  };
  commands: SandboxCommand[];
  policy: {
    network: SandboxNetworkPolicy;
    runAsRoot: false;
    secretsMount: "none";
    wallClockTimeout: number;
    maxIterations?: number;
  };
}

export interface StepResult {
  name: string;
  cmd: string;
  exitCode: number;
  stdoutSha256: string;
  stderrSha256: string;
  durationMs: number;
  stdoutTail?: string;
  stderrTail?: string;
}

export interface SandboxResult {
  runId: string;
  status: SandboxStatus;
  failureType?: SandboxFailureType;
  environmentStrategy?: {
    preferred: SandboxEnvironmentStrategy;
    detected: SandboxEnvironmentStrategy;
    fallbacks: SandboxEnvironmentStrategy[];
    notes: string;
    imageUsed?: string;
    attempted?: SandboxEnvironmentStrategy;
    failedAt?: string;
  };
  sandbox: {
    kind: "docker";
    imageDigest: string;
    network: SandboxNetworkPolicy;
    uid: number;
  };
  steps: StepResult[];
  failureObserved?: {
    kind:
      | "exception"
      | "assertion"
      | "nonzero_exit"
      | "snapshot_diff"
      | "timeout";
    matchAny?: string[];
    traceExcerptSha256?: string;
  };
  totalDurationMs: number;
  logStorageUrl?: string;
}

export class SandboxTimeoutError extends Error {
  readonly durationMs: number;

  constructor(message: string, durationMs: number) {
    super(message);
    this.name = "SandboxTimeoutError";
    this.durationMs = durationMs;
  }
}
