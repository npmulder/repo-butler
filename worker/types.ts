export type SandboxNetworkPolicy = "disabled" | "enabled";
export type SandboxEnvironmentStrategy = "devcontainer" | "dockerfile" | "bootstrap";
export type SandboxStatus = "success" | "failure" | "error" | "timeout";

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
    strategy: SandboxEnvironmentStrategy;
    dockerfilePath?: string;
    devcontainerPath?: string;
    bootstrapCommands?: string[];
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
  sandbox: {
    kind: "docker";
    imageDigest: string;
    network: SandboxNetworkPolicy;
    uid: number;
  };
  steps: StepResult[];
  failureObserved?: {
    kind: "exception" | "assertion" | "nonzero_exit" | "snapshot_diff" | "timeout";
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
