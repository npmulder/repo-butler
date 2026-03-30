import type { SandboxRequest, SandboxResult } from "../worker/types";

export async function executeSandbox(
  request: SandboxRequest,
  options?: {
    workerUrl?: string;
    secret?: string;
  },
): Promise<SandboxResult> {
  const workerUrl = options?.workerUrl ?? process.env.SANDBOX_WORKER_URL ?? "http://localhost:3001";
  const secret = options?.secret ?? process.env.SANDBOX_WORKER_SECRET;

  if (!secret) {
    throw new Error("SANDBOX_WORKER_SECRET is required");
  }

  const response = await fetch(`${workerUrl}/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(request.policy.wallClockTimeout * 1000 + 30_000),
  });

  if (!response.ok) {
    throw new Error(
      `Sandbox worker error: ${response.status} ${await response.text()}`,
    );
  }

  return (await response.json()) as SandboxResult;
}
