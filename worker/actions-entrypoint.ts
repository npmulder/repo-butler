import { createHmac } from "node:crypto";

import {
  ACTIONS_CALLBACK_SIGNATURE_HEADER,
  REPRODUCE_WORKFLOW_FILE,
  VERIFY_WORKFLOW_FILE,
} from "../lib/actions-dispatcher";
import { buildArtifactWriteCommand } from "../lib/repro-parser";
import { runSandbox } from "./sandbox-runner";
import type {
  SandboxCommand,
  SandboxEnvironmentStrategy,
  SandboxNetworkPolicy,
  SandboxRequest,
  SandboxResult,
} from "./types";

type WorkflowStage = "reproduce" | "verify";

type SharedInputs = {
  dispatchId: string;
  runId: string;
  targetRepo: string;
  targetRef: string;
  targetSha: string;
  artifactPath: string;
  artifactContent: string;
  commands: SandboxCommand[];
  callbackUrl: string;
  callbackSecret: string;
  policyNetwork: SandboxNetworkPolicy;
  policyTimeout: number;
  environmentStrategy?: SandboxEnvironmentStrategy;
  languageHint?: string;
  runtimeHint?: string;
};

function readRequiredInput(name: string): string {
  const value = process.env[`INPUT_${name.toUpperCase()}`]?.trim();

  if (!value) {
    throw new Error(`Missing required workflow input: ${name}`);
  }

  return value;
}

function readOptionalInput(name: string): string | undefined {
  const value = process.env[`INPUT_${name.toUpperCase()}`]?.trim();
  return value ? value : undefined;
}

function readOptionalNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseCommands(value: string): SandboxCommand[] {
  const parsed = JSON.parse(value) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error("commands_json must be a JSON array");
  }

  return parsed.map((command, index) => {
    if (
      typeof command !== "object" ||
      command === null ||
      typeof (command as Record<string, unknown>).name !== "string" ||
      typeof (command as Record<string, unknown>).cmd !== "string"
    ) {
      throw new Error(`Invalid command at index ${index}`);
    }

    const record = command as Record<string, unknown>;

    return {
      name: record.name as string,
      cmd: record.cmd as string,
      ...(typeof record.cwd === "string" ? { cwd: record.cwd } : {}),
      ...(typeof record.timeout === "number"
        ? { timeout: record.timeout }
        : {}),
    };
  });
}

function decodeArtifactContent(value: string): string {
  return Buffer.from(value, "base64").toString("utf8");
}

function readSharedInputs(): SharedInputs {
  const policyNetwork = readRequiredInput("policy_network");

  if (policyNetwork !== "disabled" && policyNetwork !== "enabled") {
    throw new Error("policy_network must be 'disabled' or 'enabled'");
  }

  const policyTimeout = Number.parseInt(readRequiredInput("policy_timeout"), 10);

  if (!Number.isFinite(policyTimeout) || policyTimeout <= 0) {
    throw new Error("policy_timeout must be a positive integer");
  }

  const environmentStrategy = readOptionalInput("environment_strategy");

  return {
    dispatchId: readRequiredInput("dispatch_id"),
    runId: readRequiredInput("run_id"),
    targetRepo: readRequiredInput("target_repo"),
    targetRef: readRequiredInput("target_ref"),
    targetSha: readRequiredInput("target_sha"),
    artifactPath: readRequiredInput("artifact_path"),
    artifactContent: decodeArtifactContent(readRequiredInput("artifact_content_b64")),
    commands: parseCommands(readRequiredInput("commands_json")),
    callbackUrl: readRequiredInput("callback_url"),
    callbackSecret: readRequiredInput("callback_secret"),
    policyNetwork,
    policyTimeout,
    ...(environmentStrategy
      ? { environmentStrategy: environmentStrategy as SandboxEnvironmentStrategy }
      : {}),
    ...(readOptionalInput("language_hint")
      ? { languageHint: readOptionalInput("language_hint") }
      : {}),
    ...(readOptionalInput("runtime_hint")
      ? { runtimeHint: readOptionalInput("runtime_hint") }
      : {}),
  };
}

function buildSandboxRequest(
  runId: string,
  inputs: SharedInputs,
): SandboxRequest {
  return {
    runId,
    repo: {
      cloneUrl: `https://github.com/${inputs.targetRepo}.git`,
      ref: inputs.targetRef,
      sha: inputs.targetSha,
    },
    environment: {
      ...(inputs.environmentStrategy
        ? { strategy: inputs.environmentStrategy }
        : {}),
      ...(inputs.languageHint ? { languageHint: inputs.languageHint } : {}),
      ...(inputs.runtimeHint ? { runtimeHint: inputs.runtimeHint } : {}),
    },
    commands: [
      {
        name: "write_artifact",
        cmd: buildArtifactWriteCommand({
          file_path: inputs.artifactPath,
          content: inputs.artifactContent,
          language: "shell",
        }),
      },
      ...inputs.commands,
    ],
    policy: {
      network: inputs.policyNetwork,
      runAsRoot: false,
      secretsMount: "none",
      wallClockTimeout: inputs.policyTimeout,
    },
  };
}

async function postCallback(
  inputs: SharedInputs,
  payload: Record<string, unknown>,
): Promise<void> {
  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", inputs.callbackSecret)
    .update(body)
    .digest("hex");

  const response = await fetch(inputs.callbackUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [ACTIONS_CALLBACK_SIGNATURE_HEADER]: `sha256=${signature}`,
    },
    body,
  });

  if (!response.ok) {
    throw new Error(
      `Actions callback failed: ${response.status} ${await response.text()}`,
    );
  }
}

async function executeReproduction(
  inputs: SharedInputs,
): Promise<Record<string, unknown>> {
  const sandboxResult = await runSandbox(buildSandboxRequest(inputs.runId, inputs));

  return {
    dispatch_id: inputs.dispatchId,
    run_id: inputs.runId,
    stage: "reproduce",
    workflow: REPRODUCE_WORKFLOW_FILE,
    status: "completed",
    ...(readOptionalNumber(process.env.GITHUB_RUN_ID)
      ? { github_run_id: readOptionalNumber(process.env.GITHUB_RUN_ID) }
      : {}),
    ...(readOptionalNumber(process.env.GITHUB_RUN_ATTEMPT)
      ? { github_run_attempt: readOptionalNumber(process.env.GITHUB_RUN_ATTEMPT) }
      : {}),
    ...(readOptionalNumber(readOptionalInput("iteration"))
      ? { iteration: readOptionalNumber(readOptionalInput("iteration")) }
      : {}),
    sandbox_result: sandboxResult,
  };
}

async function executeVerification(
  inputs: SharedInputs,
): Promise<Record<string, unknown>> {
  const reruns = Number.parseInt(readRequiredInput("reruns"), 10);

  if (!Number.isFinite(reruns) || reruns <= 0) {
    throw new Error("reruns must be a positive integer");
  }

  const rerunResults: SandboxResult[] = [];

  for (let attempt = 1; attempt <= reruns; attempt += 1) {
    rerunResults.push(
      await runSandbox(
        buildSandboxRequest(`${inputs.runId}_verify_${attempt}`, inputs),
      ),
    );
  }

  return {
    dispatch_id: inputs.dispatchId,
    run_id: inputs.runId,
    stage: "verify",
    workflow: VERIFY_WORKFLOW_FILE,
    status: "completed",
    ...(readOptionalNumber(process.env.GITHUB_RUN_ID)
      ? { github_run_id: readOptionalNumber(process.env.GITHUB_RUN_ID) }
      : {}),
    ...(readOptionalNumber(process.env.GITHUB_RUN_ATTEMPT)
      ? { github_run_attempt: readOptionalNumber(process.env.GITHUB_RUN_ATTEMPT) }
      : {}),
    rerun_results: rerunResults,
  };
}

async function main() {
  const stage = process.argv[2];

  if (stage !== "reproduce" && stage !== "verify") {
    throw new Error("Usage: tsx worker/actions-entrypoint.ts <reproduce|verify>");
  }

  const inputs = readSharedInputs();

  try {
    const payload =
      stage === "reproduce"
        ? await executeReproduction(inputs)
        : await executeVerification(inputs);

    await postCallback(inputs, payload);
  } catch (error) {
    const payload = {
      dispatch_id: inputs.dispatchId,
      run_id: inputs.runId,
      stage,
      workflow:
        stage === "reproduce"
          ? REPRODUCE_WORKFLOW_FILE
          : VERIFY_WORKFLOW_FILE,
      status: "failed",
      ...(readOptionalNumber(process.env.GITHUB_RUN_ID)
        ? { github_run_id: readOptionalNumber(process.env.GITHUB_RUN_ID) }
        : {}),
      ...(readOptionalNumber(process.env.GITHUB_RUN_ATTEMPT)
        ? { github_run_attempt: readOptionalNumber(process.env.GITHUB_RUN_ATTEMPT) }
        : {}),
      error: error instanceof Error ? error.message : "Unknown workflow error",
    };

    try {
      await postCallback(inputs, payload);
    } catch (postError) {
      console.error("Failed to post callback payload:", postError);
    }

    throw error;
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
