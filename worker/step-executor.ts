import { createHash } from "node:crypto";
import path from "node:path";

import type Docker from "dockerode";

import { redactSecrets as redactLoggedSecrets } from "../lib/log-redactor";
import {
  redactSecrets as redactScannedSecrets,
  scanForSecrets,
} from "../lib/security/secret-scanner";
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
  const source = `step:${step.name}`;
  const scan = scanForSecrets(`${stdout}\n${stderr}`, source);
  const sanitizedStdout = redactLoggedSecrets(redactScannedSecrets(stdout));
  const sanitizedStderr = redactLoggedSecrets(redactScannedSecrets(stderr));

  if (!scan.clean) {
    console.warn("[security] Secret-like material detected in sandbox output", {
      source,
      findings: scan.findings,
    });
  }

  return {
    timedOut,
    result: {
      name: step.name,
      cmd: step.cmd,
      exitCode,
      stdoutSha256: sha256(sanitizedStdout),
      stderrSha256: sha256(sanitizedStderr),
      durationMs,
      stdoutTail: lastNLines(sanitizedStdout, 500),
      stderrTail: lastNLines(sanitizedStderr, 500),
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
