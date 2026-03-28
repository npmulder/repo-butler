import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

function getAnthropicApiKey(): string {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required");
  }

  return apiKey;
}

export function getAnthropicClient(): Anthropic {
  if (!client) {
    client = new Anthropic({
      apiKey: getAnthropicApiKey(),
    });
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
