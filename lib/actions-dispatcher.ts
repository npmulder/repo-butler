import type {
  SandboxCommand,
  SandboxEnvironmentStrategy,
  SandboxNetworkPolicy,
} from "../worker/types";
import { getInstallationOctokit } from "./githubApp";

export const ACTIONS_CALLBACK_SIGNATURE_HEADER = "x-rb-signature";
export const REPRODUCE_WORKFLOW_FILE = "repo-butler-reproduce.yml";
export const VERIFY_WORKFLOW_FILE = "repo-butler-verify.yml";

export interface StoredDispatchInput {
  targetRepo: string;
  targetRef: string;
  targetSha: string;
  artifactPath: string;
  artifactContent: string;
  commands: SandboxCommand[];
  callbackUrl: string;
  policyNetwork: SandboxNetworkPolicy;
  policyTimeout: number;
  environmentStrategy?: SandboxEnvironmentStrategy;
  languageHint?: string;
  runtimeHint?: string;
  reruns?: number;
  iteration?: number;
}

export interface WorkflowDispatchInputs {
  [key: string]: string | undefined;
  dispatch_id: string;
  run_id: string;
  target_repo: string;
  target_ref: string;
  target_sha: string;
  artifact_path: string;
  artifact_content_b64: string;
  commands_json: string;
  callback_url: string;
  callback_secret: string;
  policy_network: string;
  policy_timeout: string;
  environment_strategy?: string;
  language_hint?: string;
  runtime_hint?: string;
  reruns?: string;
  iteration?: string;
}

export interface DispatchInput {
  installationId: number;
  owner: string;
  repo: string;
  workflowFile: string;
  ref: string;
  inputs: WorkflowDispatchInputs;
}

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  ) as ArrayBuffer;
}

async function hmacHex(
  secret: string,
  payload: string | Uint8Array,
): Promise<string> {
  const keyBytes = encodeUtf8(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(keyBytes),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = typeof payload === "string" ? encodeUtf8(payload) : payload;
  const digest = await crypto.subtle.sign("HMAC", key, toArrayBuffer(bytes));
  return bytesToHex(new Uint8Array(digest));
}

export function isActionsDispatchEnabled(): boolean {
  return process.env.USE_ACTIONS_DISPATCH?.trim().toLowerCase() === "true";
}

export function resolveWorkflowDispatchTarget(defaults: {
  owner: string;
  repo: string;
  ref: string;
}) {
  const owner = process.env.ACTIONS_DISPATCH_OWNER?.trim() || defaults.owner;
  const repo = process.env.ACTIONS_DISPATCH_REPO?.trim() || defaults.repo;
  const ref = process.env.ACTIONS_DISPATCH_REF?.trim() || defaults.ref;

  return { owner, repo, ref };
}

export function getActionsCallbackUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL?.trim();

  if (!baseUrl) {
    throw new Error(
      "NEXT_PUBLIC_CONVEX_SITE_URL is required when USE_ACTIONS_DISPATCH=true",
    );
  }

  return new URL("/actions/callback", baseUrl).toString();
}

export async function deriveActionsCallbackSecret(
  dispatchId: string,
  options?: {
    masterSecret?: string;
  },
): Promise<string> {
  const masterSecret =
    options?.masterSecret ?? process.env.ACTIONS_CALLBACK_SECRET?.trim();

  if (!masterSecret) {
    throw new Error(
      "ACTIONS_CALLBACK_SECRET is required when USE_ACTIONS_DISPATCH=true",
    );
  }

  return await hmacHex(masterSecret, dispatchId);
}

export async function buildActionsCallbackSignature(
  payload: string | Uint8Array,
  callbackSecret: string,
): Promise<string> {
  return `sha256=${await hmacHex(callbackSecret, payload)}`;
}

export async function verifyActionsCallbackSignature(input: {
  rawBody: Uint8Array;
  signature: string;
  dispatchId: string;
  masterSecret?: string;
}): Promise<boolean> {
  if (!input.signature.startsWith("sha256=")) {
    return false;
  }

  const expected = input.signature.slice("sha256=".length);
  const callbackSecret = await deriveActionsCallbackSecret(input.dispatchId, {
    masterSecret: input.masterSecret,
  });
  const computed = await hmacHex(callbackSecret, input.rawBody);

  if (expected.length !== computed.length) {
    return false;
  }

  let diff = 0;

  for (let index = 0; index < expected.length; index += 1) {
    diff |= expected.charCodeAt(index) ^ computed.charCodeAt(index);
  }

  return diff === 0;
}

export async function buildWorkflowDispatchInputs(input: {
  dispatchId: string;
  runId: string;
  stored: StoredDispatchInput;
}): Promise<WorkflowDispatchInputs> {
  const callbackSecret = await deriveActionsCallbackSecret(input.dispatchId);

  return {
    dispatch_id: input.dispatchId,
    run_id: input.runId,
    target_repo: input.stored.targetRepo,
    target_ref: input.stored.targetRef,
    target_sha: input.stored.targetSha,
    artifact_path: input.stored.artifactPath,
    artifact_content_b64: Buffer.from(
      input.stored.artifactContent,
      "utf8",
    ).toString("base64"),
    commands_json: JSON.stringify(input.stored.commands),
    callback_url: input.stored.callbackUrl,
    callback_secret: callbackSecret,
    policy_network: input.stored.policyNetwork,
    policy_timeout: String(input.stored.policyTimeout),
    ...(input.stored.environmentStrategy
      ? { environment_strategy: input.stored.environmentStrategy }
      : {}),
    ...(input.stored.languageHint
      ? { language_hint: input.stored.languageHint }
      : {}),
    ...(input.stored.runtimeHint
      ? { runtime_hint: input.stored.runtimeHint }
      : {}),
    ...(input.stored.reruns !== undefined
      ? { reruns: String(input.stored.reruns) }
      : {}),
    ...(input.stored.iteration !== undefined
      ? { iteration: String(input.stored.iteration) }
      : {}),
  };
}

export async function dispatchWorkflow(
  input: DispatchInput,
): Promise<{ dispatched: true }> {
  const octokit = await getInstallationOctokit(input.installationId);

  await octokit.rest.actions.createWorkflowDispatch({
    owner: input.owner,
    repo: input.repo,
    workflow_id: input.workflowFile,
    ref: input.ref,
    inputs: input.inputs,
  });

  return { dispatched: true };
}

export async function getWorkflowRunStatus(
  installationId: number,
  owner: string,
  repo: string,
  runId: number,
): Promise<{ status: string; conclusion: string | null }> {
  const octokit = await getInstallationOctokit(installationId);
  const { data } = await octokit.rest.actions.getWorkflowRun({
    owner,
    repo,
    run_id: runId,
  });

  return {
    status: data.status ?? "unknown",
    conclusion: data.conclusion,
  };
}
