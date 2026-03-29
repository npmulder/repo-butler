import { createHash } from "node:crypto";
import path from "node:path";

import type Docker from "dockerode";

import { execInContainer } from "./docker-manager";
import type { SandboxCommand, StepResult } from "./types";

export async function executeStep(
  container: Docker.Container,
  step: SandboxCommand,
): Promise<{ result: StepResult; timedOut: boolean }> {
  const { exitCode, stdout, stderr, durationMs, timedOut } = await execInContainer(
    container,
    ["sh", "-lc", step.cmd],
    {
      cwd: resolveWorkingDirectory(step.cwd),
      timeout: step.timeout ?? 300,
    },
  );

  return {
    timedOut,
    result: {
      name: step.name,
      cmd: step.cmd,
      exitCode,
      stdoutSha256: sha256(stdout),
      stderrSha256: sha256(stderr),
      durationMs,
      stdoutTail: lastNLines(stdout, 500),
      stderrTail: lastNLines(stderr, 500),
    },
  };
}

function resolveWorkingDirectory(cwd?: string): string | undefined {
  if (!cwd) {
    return undefined;
  }

  return path.posix.isAbsolute(cwd) ? cwd : path.posix.join("/workspace", cwd);
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function lastNLines(text: string, count: number): string {
  if (text.length === 0) {
    return "";
  }

  const lines = text.split("\n");
  return lines.slice(-count).join("\n");
}
