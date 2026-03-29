import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type Docker from "dockerode";

import {
  cleanupContainer,
  createSandboxContainer,
  ensureImageAvailable,
  getImageDigest,
} from "./docker-manager";
import { synthesizeDockerfile } from "./bootstrap-builder";
import { buildFromDevcontainer } from "./devcontainer-builder";
import { buildFromDockerfile } from "./dockerfile-builder";
import {
  detectEnvironmentStrategy,
  getFallbackStrategies,
  normalizeStrategy,
} from "./env-strategy";
import { executeStep } from "./step-executor";
import type {
  SandboxCommand,
  SandboxFailureType,
  SandboxRequest,
  SandboxResult,
  SandboxStatus,
  StepResult,
} from "./types";

const DEFAULT_SANDBOX_UID = 1000;
const DEFAULT_WALL_CLOCK_TIMEOUT_SECONDS = 1200;

type ExecutionPhase =
  | "clone_repo"
  | "prepare_workspace"
  | "detect_environment"
  | "resolve_image"
  | "create_container"
  | "setup_commands"
  | "execute_steps";

interface ResolvedEnvironment {
  image: string;
  setupCommands: SandboxCommand[];
  strategy: NonNullable<SandboxResult["environmentStrategy"]>;
}

export async function runSandbox(
  request: SandboxRequest,
): Promise<SandboxResult> {
  const startTime = Date.now();
  const sandboxRoot = await fs.mkdtemp(
    path.join(
      os.tmpdir(),
      `rb-sandbox-${sanitizeForFilesystem(request.runId)}-`,
    ),
  );
  const repoDir = path.join(sandboxRoot, "repo");
  const steps: StepResult[] = [];
  const wallClockTimeoutSeconds = Math.max(
    1,
    request.policy.wallClockTimeout || DEFAULT_WALL_CLOCK_TIMEOUT_SECONDS,
  );
  const deadline = startTime + wallClockTimeoutSeconds * 1000;
  const labels = {
    "com.repo-butler.component": "sandbox-runner",
    "com.repo-butler.run-id": request.runId,
  };

  let container: Docker.Container | null = null;
  let imageRef = "unknown";
  let imageDigest = "unknown";
  let phase: ExecutionPhase = "clone_repo";
  let environmentStrategy: SandboxResult["environmentStrategy"];

  try {
    await cloneRepo(repoDir, request.repo);
    phase = "prepare_workspace";
    await makeWorkspaceWritable(repoDir);

    phase = "detect_environment";
    const environmentPlan = await detectEnvironmentStrategy(repoDir, {
      language: request.environment.languageHint,
      runtime: request.environment.runtimeHint,
      devcontainerPath: request.environment.devcontainerPath,
      dockerfilePath: request.environment.dockerfilePath,
    });
    environmentStrategy = buildEnvironmentStrategyRecord(
      request.environment.strategy,
      environmentPlan,
    );

    phase = "resolve_image";
    const resolvedEnvironment = await resolveImage(
      repoDir,
      request.environment,
      environmentPlan,
      environmentStrategy,
      request.runId,
      labels,
    );
    environmentStrategy = resolvedEnvironment.strategy;
    imageRef = resolvedEnvironment.image;
    imageDigest = await getImageDigest(imageRef);

    phase = "create_container";
    container = await createSandboxContainer({
      image: imageRef,
      workdir: "/workspace",
      network: request.policy.network,
      uid: DEFAULT_SANDBOX_UID,
      wallClockTimeout: wallClockTimeoutSeconds,
      name: `rb-sandbox-${sanitizeForFilesystem(request.runId)}`,
      labels,
      volumes: [{ host: repoDir, container: "/workspace" }],
    });

    phase = "setup_commands";
    for (const step of resolvedEnvironment.setupCommands) {
      const remainingSeconds = Math.floor((deadline - Date.now()) / 1000);

      if (remainingSeconds <= 0) {
        return buildResult(request, steps, imageDigest, startTime, "timeout", {
          failureType: "env_setup",
          environmentStrategy: {
            ...environmentStrategy,
            failedAt: phase,
          },
        });
      }

      const execution = await executeStep(container, {
        ...step,
        timeout: Math.max(1, Math.min(step.timeout ?? 300, remainingSeconds)),
      });
      steps.push(execution.result);

      if (execution.timedOut) {
        return buildResult(request, steps, imageDigest, startTime, "timeout", {
          failureType: "env_setup",
          environmentStrategy: {
            ...environmentStrategy,
            failedAt: phase,
          },
        });
      }

      if (execution.result.exitCode !== 0) {
        return buildResult(request, steps, imageDigest, startTime, "error", {
          failureType: "env_setup",
          environmentStrategy: {
            ...environmentStrategy,
            failedAt: phase,
          },
        });
      }
    }

    phase = "execute_steps";
    for (const step of request.commands) {
      const remainingSeconds = Math.floor((deadline - Date.now()) / 1000);

      if (remainingSeconds <= 0) {
        return buildResult(request, steps, imageDigest, startTime, "timeout", {
          failureType: "repro_failure",
          environmentStrategy,
        });
      }

      const execution = await executeStep(container, {
        ...step,
        timeout: Math.max(1, Math.min(step.timeout ?? 300, remainingSeconds)),
      });
      steps.push(execution.result);

      if (execution.timedOut) {
        return buildResult(request, steps, imageDigest, startTime, "timeout", {
          failureType: "repro_failure",
          environmentStrategy,
        });
      }
    }

    const status: SandboxStatus = steps.some((step) => step.exitCode !== 0)
      ? "failure"
      : "success";

    return buildResult(request, steps, imageDigest, startTime, status, {
      failureType: status === "success" ? undefined : "repro_failure",
      environmentStrategy,
    });
  } catch {
    return buildResult(request, steps, imageDigest, startTime, "error", {
      failureType: phase === "execute_steps" ? "repro_failure" : "env_setup",
      environmentStrategy: environmentStrategy
        ? {
            ...environmentStrategy,
            failedAt: phase,
          }
        : undefined,
    });
  } finally {
    if (container) {
      await cleanupContainer(container).catch(() => undefined);
    }

    await fs.rm(sandboxRoot, { recursive: true, force: true });
  }
}

async function cloneRepo(
  repoDir: string,
  repo: { cloneUrl: string; ref: string; sha: string },
): Promise<void> {
  await runHostCommand(
    "git",
    [
      "clone",
      "--no-tags",
      "--single-branch",
      "--branch",
      repo.ref,
      repo.cloneUrl,
      repoDir,
    ],
    { timeoutMs: 2 * 60 * 1000 },
  );
  await runHostCommand(
    "git",
    ["-C", repoDir, "checkout", "--detach", repo.sha],
    {
      timeoutMs: 30 * 1000,
    },
  );
}

async function makeWorkspaceWritable(repoDir: string): Promise<void> {
  await runHostCommand("chmod", ["-R", "a+rwX", repoDir], {
    timeoutMs: 30 * 1000,
  });
}

async function resolveImage(
  repoDir: string,
  environment: SandboxRequest["environment"],
  plan: Awaited<ReturnType<typeof detectEnvironmentStrategy>>,
  strategy: NonNullable<SandboxResult["environmentStrategy"]>,
  runId: string,
  labels: Record<string, string>,
): Promise<ResolvedEnvironment> {
  switch (plan.strategy) {
    case "devcontainer": {
      if (!plan.devcontainerPath) {
        throw new Error(
          "Expected detectEnvironmentStrategy to return a devcontainer path",
        );
      }

      const result = await buildFromDevcontainer(
        repoDir,
        plan.devcontainerPath,
        {
          tag: buildImageTag(runId),
          labels,
        },
      );

      return {
        image: result.image,
        setupCommands: result.setupCommands.map((cmd, index) => ({
          name: `postCreate:${index + 1}`,
          cmd,
        })),
        strategy: {
          ...strategy,
          imageUsed: result.image,
          notes: appendNotes(strategy.notes, result.notes),
        },
      };
    }

    case "dockerfile": {
      if (!plan.dockerfilePath) {
        throw new Error(
          "Expected detectEnvironmentStrategy to return a Dockerfile path",
        );
      }

      const image = await buildFromDockerfile(
        repoDir,
        plan.dockerfilePath,
        {
          tag: buildImageTag(runId),
          labels,
        },
      );

      return {
        image,
        setupCommands: [],
        strategy: {
          ...strategy,
          imageUsed: image,
        },
      };
    }

    case "synth_dockerfile": {
      const synthesized = await synthesizeDockerfile(repoDir, {
        language: environment.languageHint,
        runtime: environment.runtimeHint,
      });

      if (!synthesized) {
        throw new Error(
          "Expected Dockerfile synthesis to succeed for the detected project",
        );
      }

      const image = await buildFromDockerfile(
        repoDir,
        synthesized.dockerfilePath,
        {
          tag: buildImageTag(runId),
          labels,
        },
      );

      return {
        image,
        setupCommands: [],
        strategy: {
          ...strategy,
          imageUsed: image,
          notes: appendNotes(strategy.notes, [
            `Generated ${path.basename(synthesized.dockerfilePath)} for ${synthesized.detection.language} (${synthesized.detection.packageManager})`,
          ]),
        },
      };
    }

    case "bootstrap":
    default: {
      const baseImage =
        plan.image ?? process.env.SANDBOX_BASE_IMAGE ?? "ubuntu:22.04";
      await ensureImageAvailable(baseImage);
      return {
        image: baseImage,
        setupCommands: (environment.bootstrapCommands ?? []).map(
          (cmd, index) => ({
            name: `bootstrap:${index + 1}`,
            cmd,
          }),
        ),
        strategy: {
          ...strategy,
          imageUsed: baseImage,
        },
      };
    }
  }
}

function buildResult(
  request: SandboxRequest,
  steps: StepResult[],
  imageDigest: string,
  startTime: number,
  status: SandboxStatus,
  options: {
    failureType?: SandboxFailureType;
    environmentStrategy?: SandboxResult["environmentStrategy"];
  } = {},
): SandboxResult {
  const failingStep = [...steps].reverse().find((step) => step.exitCode !== 0);

  return {
    runId: request.runId,
    status,
    ...(options.failureType ? { failureType: options.failureType } : {}),
    ...(options.environmentStrategy
      ? { environmentStrategy: options.environmentStrategy }
      : {}),
    sandbox: {
      kind: "docker",
      imageDigest,
      network: request.policy.network,
      uid: DEFAULT_SANDBOX_UID,
    },
    steps,
    failureObserved:
      status === "timeout"
        ? {
            kind: "timeout",
            traceExcerptSha256: failingStep?.stderrSha256,
          }
        : failingStep
          ? {
              kind: "nonzero_exit",
              traceExcerptSha256:
                failingStep.stderrSha256 ||
                failingStep.stdoutSha256 ||
                undefined,
            }
          : undefined,
    totalDurationMs: Date.now() - startTime,
  };
}

function buildEnvironmentStrategyRecord(
  preferredStrategy: SandboxRequest["environment"]["strategy"],
  plan: Awaited<ReturnType<typeof detectEnvironmentStrategy>>,
): NonNullable<SandboxResult["environmentStrategy"]> {
  return {
    preferred: normalizeStrategy(preferredStrategy) ?? plan.strategy,
    detected: plan.strategy,
    fallbacks: getFallbackStrategies(plan.strategy),
    notes: plan.notes,
    attempted: plan.strategy,
  };
}

function sanitizeForFilesystem(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "-");
}

function buildImageTag(runId: string): string {
  return `rb-sandbox:${sanitizeForFilesystem(runId)}-${Date.now()}`;
}

function appendNotes(base: string, extras: string[]): string {
  if (extras.length === 0) {
    return base;
  }

  return `${base} (${extras.join(" ")})`;
}

function runHostCommand(
  command: string,
  args: string[],
  options: { timeoutMs: number; cwd?: string },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);

      if (code === 0) {
        resolve();
        return;
      }

      const output = Buffer.concat([...stdout, ...stderr])
        .toString("utf8")
        .trim();
      const reason = timedOut
        ? `timed out after ${options.timeoutMs}ms`
        : `exited with code ${code ?? "unknown"}`;
      reject(
        new Error(
          `${command} ${reason}${output ? `: ${output.slice(0, 4000)}` : ""}`,
        ),
      );
    });
  });
}
