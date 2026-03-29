import Anthropic, { type ClientOptions } from "@anthropic-ai/sdk";

export type LlmProvider = "anthropic" | "openrouter";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api";
const OPENROUTER_APP_TITLE = "Repo Butler";
const DEFAULT_APP_URL = "http://localhost:3000";

const DIRECT_MODELS = {
  triage: "claude-sonnet-4-20250514",
  reproduce: "claude-sonnet-4-20250514",
  verify: "claude-sonnet-4-20250514",
} as const;

const OPENROUTER_MODEL_MAP = {
  "claude-sonnet-4-20250514": "anthropic/claude-sonnet-4",
} as const;

let client: Anthropic | null = null;

function getRequiredEnvVar(name: "ANTHROPIC_API_KEY" | "OPENROUTER_API_KEY"): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

export function getLlmProvider(): LlmProvider {
  const provider = process.env.LLM_PROVIDER?.trim().toLowerCase();

  if (!provider || provider === "anthropic") {
    return "anthropic";
  }

  if (provider === "openrouter") {
    return "openrouter";
  }

  throw new Error(`Unsupported LLM_PROVIDER: ${process.env.LLM_PROVIDER}`);
}

const llmProvider = getLlmProvider();

function normalizeAppUrl(candidate: string | undefined): string | null {
  if (!candidate) {
    return null;
  }

  const trimmed = candidate.trim();

  if (!trimmed) {
    return null;
  }

  try {
    const withProtocol = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;

    return new URL(withProtocol).origin;
  } catch {
    return null;
  }
}

function getRepoButlerAppUrl(): string {
  const appUrl =
    normalizeAppUrl(process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI) ??
    normalizeAppUrl(process.env.VERCEL_BRANCH_URL) ??
    normalizeAppUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
    normalizeAppUrl(process.env.VERCEL_URL);

  return appUrl ?? DEFAULT_APP_URL;
}

function getAnthropicClientConfig(): ClientOptions {
  if (llmProvider === "openrouter") {
    return {
      apiKey: getRequiredEnvVar("OPENROUTER_API_KEY"),
      baseURL: OPENROUTER_BASE_URL,
      defaultHeaders: {
        "HTTP-Referer": getRepoButlerAppUrl(),
        "X-Title": OPENROUTER_APP_TITLE,
      },
    };
  }

  return {
    apiKey: getRequiredEnvVar("ANTHROPIC_API_KEY"),
  };
}

export function getAnthropicClient(): Anthropic {
  if (!client) {
    client = new Anthropic(getAnthropicClientConfig());
  }

  return client;
}

function mapModelForOpenRouter(
  model: (typeof DIRECT_MODELS)[keyof typeof DIRECT_MODELS],
): string {
  return OPENROUTER_MODEL_MAP[model];
}

export const MODELS =
  llmProvider === "openrouter"
    ? {
        triage: mapModelForOpenRouter(DIRECT_MODELS.triage),
        reproduce: mapModelForOpenRouter(DIRECT_MODELS.reproduce),
        verify: mapModelForOpenRouter(DIRECT_MODELS.verify),
      }
    : DIRECT_MODELS;

export const DEFAULT_MAX_TOKENS = 4096;

export interface TriageInput {
  repo: { owner: string; name: string; defaultBranch: string };
  issue: {
    number: number;
    title: string;
    body: string;
    url: string;
    author: string;
    labels: string[];
    createdAt: string;
  };
  repoContext?: {
    languages: string[];
    hasTestFramework: boolean;
    testCommand?: string;
    readme?: string;
  };
}
