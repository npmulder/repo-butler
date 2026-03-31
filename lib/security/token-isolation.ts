import type { SandboxRequest } from "../../worker/types";

export enum TokenContext {
  CONTROL_PLANE = "control_plane",
  EXECUTION_PLANE = "execution_plane",
}

type TokenPermission = {
  allowedContexts: TokenContext[];
  permissions: string[];
};

export const TOKEN_PERMISSIONS: Record<string, TokenPermission> = {
  GITHUB_APP_PRIVATE_KEY: {
    allowedContexts: [TokenContext.CONTROL_PLANE],
    permissions: ["generate installation tokens"],
  },
  GITHUB_INSTALLATION_TOKEN: {
    allowedContexts: [TokenContext.CONTROL_PLANE],
    permissions: ["issues:write", "contents:read", "pull_requests:write"],
  },
  ANTHROPIC_API_KEY: {
    allowedContexts: [TokenContext.CONTROL_PLANE],
    permissions: ["claude api access"],
  },
  SANDBOX_WORKER_SECRET: {
    allowedContexts: [TokenContext.CONTROL_PLANE],
    permissions: ["worker authentication"],
  },
  WEBHOOK_SECRET: {
    allowedContexts: [TokenContext.CONTROL_PLANE],
    permissions: ["webhook verification"],
  },
};

type SandboxValidationResult = {
  safe: boolean;
  violations: string[];
};

const TOKEN_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: "GitHub PAT", pattern: /ghp_[A-Za-z0-9]{36}/ },
  { name: "GitHub App token", pattern: /ghs_[A-Za-z0-9]{36}/ },
  {
    name: "GitHub fine-grained token",
    pattern: /github_pat_[A-Za-z0-9_]{22}_[A-Za-z0-9_]{59}/,
  },
  { name: "Anthropic key", pattern: /sk-ant-[A-Za-z0-9-]+/ },
  {
    name: "Private key",
    pattern: /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/,
  },
  {
    name: "Bearer token",
    pattern: /Bearer\s+[A-Za-z0-9._~+/-]{20,}/i,
  },
];

function stringifyRequest(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function hasEmbeddedCredentials(cloneUrl: string) {
  if (cloneUrl.includes("x-access-token:")) {
    return true;
  }

  try {
    const parsed = new URL(cloneUrl);
    return parsed.username.length > 0 || parsed.password.length > 0;
  } catch {
    return /https?:\/\/[^/\s]+@/i.test(cloneUrl);
  }
}

export function validateSandboxRequest(
  request: SandboxRequest | Record<string, unknown> | unknown,
): SandboxValidationResult {
  const violations: string[] = [];
  const serializedRequest = stringifyRequest(request);

  for (const { name, pattern } of TOKEN_PATTERNS) {
    if (pattern.test(serializedRequest)) {
      violations.push(`${name} detected in sandbox request`);
    }
  }

  if (
    typeof request === "object" &&
    request !== null &&
    "repo" in request &&
    typeof request.repo === "object" &&
    request.repo !== null &&
    "cloneUrl" in request.repo &&
    typeof request.repo.cloneUrl === "string" &&
    hasEmbeddedCredentials(request.repo.cloneUrl)
  ) {
    violations.push("Clone URL contains embedded credentials");
  }

  return {
    safe: violations.length === 0,
    violations,
  };
}

export function assertSandboxRequestSafe(
  request: SandboxRequest | Record<string, unknown> | unknown,
) {
  const validation = validateSandboxRequest(request);

  if (!validation.safe) {
    throw new Error(
      `Sandbox request contains sensitive data: ${validation.violations.join("; ")}`,
    );
  }
}
