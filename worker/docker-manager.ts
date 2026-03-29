import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";

import Docker from "dockerode";

import { SandboxTimeoutError, type SandboxNetworkPolicy } from "./types";

const docker = new Docker();
const MAX_OUTPUT_BYTES = 1024 * 1024;

export interface ContainerConfig {
  image: string;
  workdir: string;
  network: SandboxNetworkPolicy;
  uid: number;
  wallClockTimeout: number;
  name?: string;
  labels?: Record<string, string>;
  volumes: Array<{ host: string; container: string; readonly?: boolean }>;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export async function ensureImageAvailable(image: string): Promise<void> {
  try {
    await docker.getImage(image).inspect();
    return;
  } catch (error) {
    if (!isDockerNotFound(error)) {
      throw error;
    }
  }

  const stream = await docker.pull(image);
  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(stream, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export async function buildDockerImage(options: {
  contextDir: string;
  dockerfilePath: string;
  tag: string;
  labels?: Record<string, string>;
  buildArgs?: Record<string, string>;
}): Promise<string> {
  const args = ["build", "-q", "-f", options.dockerfilePath, "-t", options.tag];

  for (const [key, value] of Object.entries(options.buildArgs ?? {})) {
    args.push("--build-arg", `${key}=${value}`);
  }

  for (const [key, value] of Object.entries(options.labels ?? {})) {
    args.push("--label", `${key}=${value}`);
  }

  args.push(options.contextDir);

  await runHostCommand("docker", args, {
    cwd: options.contextDir,
    timeoutMs: 10 * 60 * 1000,
  });

  return options.tag;
}

export async function createSandboxContainer(
  config: ContainerConfig,
): Promise<Docker.Container> {
  const container = await docker.createContainer({
    name: config.name,
    Image: config.image,
    Cmd: ["sleep", "infinity"],
    WorkingDir: config.workdir,
    User: `${config.uid}:${config.uid}`,
    Labels: config.labels,
    NetworkDisabled: config.network === "disabled",
    HostConfig: {
      Memory: 2 * 1024 * 1024 * 1024,
      MemorySwap: 2 * 1024 * 1024 * 1024,
      CpuPeriod: 100000,
      CpuQuota: 200000,
      PidsLimit: 256,
      ReadonlyRootfs: false,
      SecurityOpt: ["no-new-privileges"],
      Binds: config.volumes.map(
        (volume) =>
          `${volume.host}:${volume.container}:${volume.readonly ? "ro" : "rw"}`,
      ),
      CapDrop: ["ALL"],
    },
  });

  await container.start();
  return container;
}

export async function execInContainer(
  container: Docker.Container,
  cmd: string[],
  options: { cwd?: string; timeout?: number } = {},
): Promise<ExecResult> {
  const startTime = Date.now();
  const timeoutSeconds = Math.max(1, options.timeout ?? 300);

  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
    WorkingDir: options.cwd,
  });

  const stream = await exec.start({ hijack: true, stdin: false });
  const output = await collectStreamOutput(container, stream, timeoutSeconds);
  const durationMs = Date.now() - startTime;

  if (output.timedOut) {
    const timeoutMessage = `Command exceeded timeout of ${timeoutSeconds}s`;

    return {
      exitCode: 124,
      stdout: output.stdout,
      stderr: appendLine(output.stderr, timeoutMessage),
      durationMs,
      timedOut: true,
    };
  }

  const inspect = await exec.inspect();

  return {
    exitCode: inspect.ExitCode ?? -1,
    stdout: output.stdout,
    stderr: output.stderr,
    durationMs,
    timedOut: false,
  };
}

export async function getImageDigest(imageRef: string): Promise<string> {
  const info = await docker.getImage(imageRef).inspect();
  return info.RepoDigests?.[0] ?? info.Id;
}

export async function cleanupContainer(
  container: Docker.Container,
): Promise<void> {
  try {
    await container.stop({ t: 0 });
  } catch (error) {
    if (!isIgnorableContainerError(error)) {
      throw error;
    }
  }

  try {
    await container.remove({ force: true });
  } catch (error) {
    if (!isIgnorableContainerError(error)) {
      throw error;
    }
  }
}

async function collectStreamOutput(
  container: Docker.Container,
  stream: Readable,
  timeoutSeconds: number,
): Promise<{ stdout: string; stderr: string; timedOut: boolean }> {
  const stdoutSink = new CappedBufferSink(MAX_OUTPUT_BYTES);
  const stderrSink = new CappedBufferSink(MAX_OUTPUT_BYTES);
  let timedOut = false;

  docker.modem.demuxStream(stream, stdoutSink, stderrSink);

  const timer = setTimeout(() => {
    timedOut = true;
    void container.kill().catch(() => undefined);
    stream.destroy(
      new SandboxTimeoutError(
        "Sandbox command timed out",
        timeoutSeconds * 1000,
      ),
    );
  }, timeoutSeconds * 1000);

  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      resolve();
    };

    stream.on("end", finish);
    stream.on("close", finish);
    stream.on("error", (error) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve();
        return;
      }
      reject(error);
    });
  });

  stdoutSink.end();
  stderrSink.end();

  return {
    stdout: stdoutSink.toString(),
    stderr: stderrSink.toString(),
    timedOut,
  };
}

class CappedBufferSink extends Writable {
  private readonly chunks: Buffer[] = [];
  private size = 0;

  constructor(private readonly maxBytes: number) {
    super();
  }

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

    if (this.size < this.maxBytes) {
      const remaining = this.maxBytes - this.size;
      const nextChunk =
        buffer.byteLength > remaining ? buffer.subarray(0, remaining) : buffer;

      this.chunks.push(nextChunk);
      this.size += nextChunk.byteLength;
    }

    callback();
  }

  override toString(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

function appendLine(text: string, line: string): string {
  if (text.length === 0) {
    return line;
  }

  return `${text}\n${line}`;
}

function isDockerNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    error.statusCode === 404
  );
}

function isIgnorableContainerError(error: unknown): boolean {
  return (
    isDockerNotFound(error) ||
    (typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      (error.statusCode === 304 || error.statusCode === 409))
  );
}

function runHostCommand(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs: number },
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
