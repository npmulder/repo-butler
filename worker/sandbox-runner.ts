import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type Docker from "dockerode";

import {
  buildDockerImage,
  cleanupContainer,
  createSandboxContainer,
  ensureImageAvailable,
  getImageDigest,
} from "./docker-manager";
import { executeStep } from "./step-executor";
import type {
  SandboxCommand,
  SandboxRequest,
  SandboxResult,
  SandboxStatus,
  StepResult,
} from "./types";

const DEFAULT_SANDBOX_UID = 1000;
const DEFAULT_WALL_CLOCK_TIMEOUT_SECONDS = 1200;
const DEFAULT_BASE_IMAGE = "node:20-bookworm-slim";

export async function runSandbox(request: SandboxRequest): Promise<SandboxResult> {
  const startTime = Date.now();
  const sandboxRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), `rb-sandbox-${sanitizeForFilesystem(request.runId)}-`),
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

  try {
    await cloneRepo(repoDir, request.repo);
    await makeWorkspaceWritable(repoDir);

    imageRef = await resolveImage(repoDir, request.environment, request.runId, labels);
    imageDigest = await getImageDigest(imageRef);

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

    for (const step of expandCommands(request.environment, request.commands)) {
      const remainingSeconds = Math.floor((deadline - Date.now()) / 1000);

      if (remainingSeconds <= 0) {
        return buildResult(request, steps, imageDigest, startTime, "timeout");
      }

      const execution = await executeStep(container, {
        ...step,
        timeout: Math.max(1, Math.min(step.timeout ?? 300, remainingSeconds)),
      });
      steps.push(execution.result);

      if (execution.timedOut) {
        return buildResult(request, steps, imageDigest, startTime, "timeout");
      }
    }

    const status: SandboxStatus = steps.some((step) => step.exitCode !== 0)
      ? "failure"
      : "success";

    return buildResult(request, steps, imageDigest, startTime, status);
  } catch {
    return buildResult(request, steps, imageDigest, startTime, "error");
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
    ["clone", "--no-tags", "--single-branch", "--branch", repo.ref, repo.cloneUrl, repoDir],
    { timeoutMs: 2 * 60 * 1000 },
  );
  await runHostCommand("git", ["-C", repoDir, "checkout", "--detach", repo.sha], {
    timeoutMs: 30 * 1000,
  });
}

async function makeWorkspaceWritable(repoDir: string): Promise<void> {
  await runHostCommand("chmod", ["-R", "a+rwX", repoDir], {
    timeoutMs: 30 * 1000,
  });
}

async function resolveImage(
  repoDir: string,
  environment: SandboxRequest["environment"],
  runId: string,
  labels: Record<string, string>,
): Promise<string> {
  switch (environment.strategy) {
    case "dockerfile":
      return buildImageFromDockerfile(
        repoDir,
        environment.dockerfilePath ?? "Dockerfile",
        runId,
        labels,
      );
    case "devcontainer":
      return resolveDevcontainerImage(
        repoDir,
        environment.devcontainerPath ?? ".devcontainer/devcontainer.json",
        runId,
        labels,
      );
    case "bootstrap":
    default: {
      const baseImage = process.env.SANDBOX_BASE_IMAGE ?? DEFAULT_BASE_IMAGE;
      await ensureImageAvailable(baseImage);
      return baseImage;
    }
  }
}

async function buildImageFromDockerfile(
  repoDir: string,
  dockerfilePath: string,
  runId: string,
  labels: Record<string, string>,
): Promise<string> {
  const resolvedDockerfile = path.resolve(repoDir, dockerfilePath);
  const tag = `rb-sandbox:${sanitizeForFilesystem(runId)}-${Date.now()}`;

  return buildDockerImage({
    contextDir: repoDir,
    dockerfilePath: resolvedDockerfile,
    tag,
    labels,
  });
}

async function resolveDevcontainerImage(
  repoDir: string,
  devcontainerPath: string,
  runId: string,
  labels: Record<string, string>,
): Promise<string> {
  const resolvedConfigPath = path.resolve(repoDir, devcontainerPath);
  const rawConfig = await fs.readFile(resolvedConfigPath, "utf8");
  const config = JSON.parse(stripJsonComments(rawConfig)) as {
    image?: string;
    dockerFile?: string;
    context?: string;
    build?: {
      dockerfile?: string;
      dockerFile?: string;
      context?: string;
    };
  };

  if (config.image) {
    await ensureImageAvailable(config.image);
    return config.image;
  }

  const dockerfilePath =
    config.build?.dockerfile ?? config.build?.dockerFile ?? config.dockerFile;

  if (dockerfilePath) {
    const configDir = path.dirname(resolvedConfigPath);
    const contextDir = path.resolve(
      configDir,
      config.build?.context ?? config.context ?? ".",
    );
    const resolvedDockerfile = path.resolve(configDir, dockerfilePath);
    const tag = `rb-sandbox:${sanitizeForFilesystem(runId)}-${Date.now()}`;

    return buildDockerImage({
      contextDir,
      dockerfilePath: resolvedDockerfile,
      tag,
      labels,
    });
  }

  const baseImage = process.env.SANDBOX_BASE_IMAGE ?? DEFAULT_BASE_IMAGE;
  await ensureImageAvailable(baseImage);
  return baseImage;
}

function expandCommands(
  environment: SandboxRequest["environment"],
  commands: SandboxCommand[],
): SandboxCommand[] {
  if (environment.strategy !== "bootstrap" || !environment.bootstrapCommands?.length) {
    return commands;
  }

  const bootstrapSteps = environment.bootstrapCommands.map((cmd, index) => ({
    name: `bootstrap:${index + 1}`,
    cmd,
  }));

  return [...bootstrapSteps, ...commands];
}

function buildResult(
  request: SandboxRequest,
  steps: StepResult[],
  imageDigest: string,
  startTime: number,
  status: SandboxStatus,
): SandboxResult {
  const failingStep = [...steps].reverse().find((step) => step.exitCode !== 0);

  return {
    runId: request.runId,
    status,
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
                failingStep.stderrSha256 || failingStep.stdoutSha256 || undefined,
            }
          : undefined,
    totalDurationMs: Date.now() - startTime,
  };
}

function sanitizeForFilesystem(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "-");
}

function stripJsonComments(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
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

      const output = Buffer.concat([...stdout, ...stderr]).toString("utf8").trim();
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
