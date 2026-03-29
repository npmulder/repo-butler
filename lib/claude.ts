import Anthropic from "@anthropic-ai/sdk";

export type LlmProvider = "anthropic" | "openrouter";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api";

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

function getAnthropicClientConfig(): { apiKey: string; baseURL?: string } {
  if (getLlmProvider() === "openrouter") {
    return {
      apiKey: getRequiredEnvVar("OPENROUTER_API_KEY"),
      baseURL: OPENROUTER_BASE_URL,
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

export const MODELS = {
  triage: "claude-sonnet-4-20250514",
  reproduce: "claude-sonnet-4-20250514",
  verify: "claude-sonnet-4-20250514",
} as const;

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
