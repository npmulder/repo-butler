import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";

import { runSandbox } from "./sandbox-runner";
import type { SandboxRequest, SandboxResult } from "./types";

const MAX_REQUEST_BYTES = 10 * 1024 * 1024;

export interface SandboxServerOptions {
  workerSecret?: string;
  runner?: (request: SandboxRequest) => Promise<SandboxResult>;
}

export function createSandboxServer(options: SandboxServerOptions = {}): Server {
  const workerSecret = options.workerSecret ?? process.env.SANDBOX_WORKER_SECRET;

  if (!workerSecret) {
    throw new Error("SANDBOX_WORKER_SECRET is required");
  }

  const runner = options.runner ?? runSandbox;

  return createServer(async (req, res) => {
    try {
      if (!req.url) {
        sendJson(res, 400, { error: "Missing request URL" });
        return;
      }

      const url = new URL(req.url, "http://sandbox-worker.local");

      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, { status: "ok", docker: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/execute") {
        if (req.headers.authorization !== `Bearer ${workerSecret}`) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }

        const request = (await readJsonBody(req)) as SandboxRequest;
        const result = await runner(request);
        sendJson(res, 200, result);
        return;
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(res, error.statusCode, { error: error.message });
        return;
      }

      sendJson(res, 500, {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });
}

export async function startSandboxServer(
  options: SandboxServerOptions = {},
): Promise<Server> {
  const port = Number.parseInt(process.env.SANDBOX_WORKER_PORT ?? "3001", 10);
  const host = process.env.SANDBOX_WORKER_HOST ?? "0.0.0.0";
  const server = createSandboxServer(options);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  return server;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;

    if (size > MAX_REQUEST_BYTES) {
      throw new HttpError(413, "Request body too large");
    }

    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    throw new HttpError(400, "Request body is required");
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function isMainModule(importMetaUrl: string): boolean {
  return process.argv[1] === fileURLToPath(importMetaUrl);
}

if (isMainModule(import.meta.url)) {
  void startSandboxServer()
    .then(() => {
      const port = process.env.SANDBOX_WORKER_PORT ?? "3001";
      console.log(`Sandbox worker listening on port ${port}`);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
