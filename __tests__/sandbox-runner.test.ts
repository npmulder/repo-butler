// @vitest-environment node

import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import Docker from "dockerode";
import { afterEach, describe, expect, it } from "vitest";

import { executeSandbox } from "../lib/sandbox-client";
import { runSandbox } from "../worker/sandbox-runner";
import { createSandboxServer } from "../worker/server";
import type { SandboxRequest } from "../worker/types";

const docker = new Docker();
const fixtureSourceDir = path.join(
  process.cwd(),
  "__tests__/fixtures/toy-repo",
);
const dockerAvailable = await isDockerAvailable();
const sandboxSuite = dockerAvailable ? describe : describe.skip;

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanupTasks.length > 0) {
    const cleanup = cleanupTasks.pop();
    if (cleanup) {
      await cleanup();
    }
  }
}, 60_000);

describe("sandbox server auth", () => {
  it("rejects unauthorized execute requests", async () => {
    const server = createSandboxServer({
      workerSecret: "expected-secret",
      runner: async () => {
        throw new Error("runner should not be called without auth");
      },
    });
    cleanupTasks.push(async () => {
      server.close();
      await once(server, "close");
    });

    await listen(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected a TCP server address");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong-secret",
      },
      body: JSON.stringify({ runId: "auth-check" }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });
});

sandboxSuite("runSandbox integration", () => {
  it("runs a passing sandbox request through the HTTP worker and client", async () => {
    const fixture = await createFixtureRepository("happy-path");
    const server = createSandboxServer({ workerSecret: "sandbox-secret" });
    cleanupTasks.push(fixture.cleanup);
    cleanupTasks.push(async () => {
      await closeServer(server);
    });

    await listen(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected a TCP server address");
    }

    const result = await executeSandbox(
      createRequest(fixture, {
        runId: "happy-path",
        commands: [{ name: "passing test", cmd: "npm run test:pass" }],
      }),
      {
        workerUrl: `http://127.0.0.1:${address.port}`,
        secret: "sandbox-secret",
      },
    );

    expect(result.status).toBe("success");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toEqual(
      expect.objectContaining({
        name: "passing test",
        exitCode: 0,
      }),
    );
    expect(result.environmentStrategy).toEqual(
      expect.objectContaining({
        detected: "dockerfile",
        imageUsed: expect.any(String),
      }),
    );
    expect(result.failureType).toBeUndefined();
    expect(result.sandbox.kind).toBe("docker");
    expect(result.sandbox.network).toBe("disabled");
    expect(result.sandbox.uid).toBe(1000);
  }, 60_000);

  it("records a deterministic failing reproduction", async () => {
    const fixture = await createFixtureRepository("failing-run");
    cleanupTasks.push(fixture.cleanup);

    const result = await runSandbox(
      createRequest(fixture, {
        runId: "failing-run",
        commands: [{ name: "failing test", cmd: "npm run test:fail" }],
      }),
    );

    expect(result.status).toBe("failure");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.exitCode).not.toBe(0);
    expect(result.failureType).toBe("repro_failure");
    expect(result.failureObserved).toEqual(
      expect.objectContaining({ kind: "nonzero_exit" }),
    );
  });

  it("blocks outbound network when the sandbox policy disables it", async () => {
    const fixture = await createFixtureRepository("network-disabled");
    cleanupTasks.push(fixture.cleanup);

    const result = await runSandbox(
      createRequest(fixture, {
        runId: "network-disabled",
        commands: [
          {
            name: "network probe",
            cmd: "node -e \"fetch('https://example.com').then(() => process.exit(0)).catch((error) => { console.error(error.message); process.exit(7); })\"",
            timeout: 20,
          },
        ],
      }),
    );

    expect(result.status).toBe("failure");
    expect(result.steps[0]).toEqual(
      expect.objectContaining({
        name: "network probe",
        exitCode: 7,
      }),
    );
  });

  it("enforces per-step timeouts", async () => {
    const fixture = await createFixtureRepository("timeout-run");
    cleanupTasks.push(fixture.cleanup);

    const result = await runSandbox(
      createRequest(fixture, {
        runId: "timeout-run",
        commands: [
          {
            name: "sleep forever",
            cmd: 'node -e "setInterval(() => {}, 1000)"',
            timeout: 2,
          },
        ],
        policy: {
          wallClockTimeout: 15,
        },
      }),
    );

    expect(result.status).toBe("timeout");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toEqual(
      expect.objectContaining({
        name: "sleep forever",
        exitCode: 124,
      }),
    );
    expect(result.failureObserved).toEqual(
      expect.objectContaining({ kind: "timeout" }),
    );
  });

  it("runs the sandbox container as UID 1000", async () => {
    const fixture = await createFixtureRepository("uid-check");
    cleanupTasks.push(fixture.cleanup);

    const result = await runSandbox(
      createRequest(fixture, {
        runId: "uid-check",
        commands: [{ name: "show uid", cmd: "id -u" }],
      }),
    );

    expect(result.status).toBe("success");
    expect(result.steps[0]?.stdoutTail?.trim()).toBe("1000");
  });

  it("cleans up containers and temporary workspaces after execution", async () => {
    const fixture = await createFixtureRepository("cleanup-check");
    cleanupTasks.push(fixture.cleanup);

    const runId = "cleanup-check";
    const beforeContainers = await listSandboxContainers(runId);
    const beforeDirs = await listSandboxDirs(runId);

    expect(beforeContainers).toHaveLength(0);
    expect(beforeDirs).toHaveLength(0);

    const result = await runSandbox(
      createRequest(fixture, {
        runId,
        commands: [{ name: "passing test", cmd: "npm run test:pass" }],
      }),
    );

    expect(result.status).toBe("success");

    await delay(250);
    expect(await listSandboxContainers(runId)).toHaveLength(0);
    expect(await listSandboxDirs(runId)).toHaveLength(0);
  });

  it("records hashes, durations, and exit codes for every step", async () => {
    const fixture = await createFixtureRepository("step-recording");
    cleanupTasks.push(fixture.cleanup);

    const result = await runSandbox(
      createRequest(fixture, {
        runId: "step-recording",
        commands: [
          { name: "echo ok", cmd: "printf 'alpha\\n'" },
          {
            name: "echo failure",
            cmd: "printf 'beta\\n'; printf 'problem\\n' 1>&2; exit 3",
          },
        ],
      }),
    );

    expect(result.status).toBe("failure");
    expect(result.steps).toHaveLength(2);

    for (const step of result.steps) {
      expect(step.exitCode).toBeTypeOf("number");
      expect(step.durationMs).toBeGreaterThanOrEqual(0);
      expect(step.stdoutSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(step.stderrSha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});

async function createFixtureRepository(suffix: string) {
  const repoDir = await fs.mkdtemp(
    path.join(os.tmpdir(), `toy-sandbox-${suffix}-`),
  );
  await fs.cp(fixtureSourceDir, repoDir, { recursive: true });
  await runCommand("git", ["init", "-b", "main"], repoDir);
  await runCommand(
    "git",
    ["config", "user.email", "codex@example.com"],
    repoDir,
  );
  await runCommand("git", ["config", "user.name", "Codex"], repoDir);
  await runCommand("git", ["add", "."], repoDir);
  await runCommand("git", ["commit", "-m", "Initial fixture"], repoDir);

  const sha = (await runCommand("git", ["rev-parse", "HEAD"], repoDir)).trim();

  return {
    cloneUrl: repoDir,
    ref: "main",
    sha,
    cleanup: async () => {
      await fs.rm(repoDir, { recursive: true, force: true });
    },
  };
}

function createRequest(
  fixture: { cloneUrl: string; ref: string; sha: string },
  overrides: {
    runId: string;
    commands: SandboxRequest["commands"];
    policy?: Partial<SandboxRequest["policy"]>;
  },
): SandboxRequest {
  return {
    runId: overrides.runId,
    repo: fixture,
    environment: {
      languageHint: "typescript",
      runtimeHint: "20",
    },
    commands: overrides.commands,
    policy: {
      network: "disabled",
      runAsRoot: false,
      secretsMount: "none",
      wallClockTimeout: overrides.policy?.wallClockTimeout ?? 120,
      maxIterations: overrides.policy?.maxIterations,
    },
  };
}

async function isDockerAvailable(): Promise<boolean> {
  try {
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}

async function listen(
  server: ReturnType<typeof createSandboxServer>,
): Promise<void> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
}

async function closeServer(
  server: ReturnType<typeof createSandboxServer>,
): Promise<void> {
  if (!server.listening) {
    return;
  }

  server.closeAllConnections?.();

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function listSandboxContainers(runId: string) {
  return docker.listContainers({
    all: true,
    filters: {
      label: [`com.repo-butler.run-id=${runId}`],
    },
  });
}

async function listSandboxDirs(runId: string): Promise<string[]> {
  const prefix = `rb-sandbox-${runId}-`;
  const entries = await fs.readdir(os.tmpdir());
  return entries.filter((entry) => entry.startsWith(prefix));
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf8"));
        return;
      }

      reject(
        new Error(
          `${command} exited with code ${code}: ${Buffer.concat(stderr).toString("utf8")}`,
        ),
      );
    });
  });
}
