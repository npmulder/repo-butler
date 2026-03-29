import Anthropic from "@anthropic-ai/sdk";

type LlmProvider = "anthropic" | "openrouter";
type OpenRouterRoute = "fallback" | "cheapest";
type AnthropicMessageCreateParams = Parameters<Anthropic["messages"]["create"]>[0];
type AnthropicRequestOptions = NonNullable<
  Parameters<Anthropic["messages"]["create"]>[1]
>;
type OpenRouterProviderPreferences =
  | {
      order: string[];
      allow_fallbacks: true;
    }
  | {
      sort: "price";
    };

const OPENROUTER_BASE_URL = "https://openrouter.ai/api";
const DEFAULT_OPENROUTER_PROVIDER_ORDER = [
  "anthropic",
  "amazon-bedrock",
  "google-vertex",
] as const;
const OPENROUTER_PROVIDER_ALIASES = {
  anthropic: "anthropic",
  "amazon bedrock": "amazon-bedrock",
  "amazon-bedrock": "amazon-bedrock",
  bedrock: "amazon-bedrock",
  google: "google-vertex",
  "google vertex": "google-vertex",
  "google-vertex": "google-vertex",
  "google ai studio": "google-ai-studio",
  "google-ai-studio": "google-ai-studio",
} as const;

let client: Anthropic | null = null;

function getRequiredEnvVar(name: "ANTHROPIC_API_KEY" | "OPENROUTER_API_KEY"): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function getLlmProvider(): LlmProvider {
  const provider = process.env.LLM_PROVIDER?.trim().toLowerCase();

  if (!provider || provider === "anthropic") {
    return "anthropic";
  }

  if (provider === "openrouter") {
    return "openrouter";
  }

  throw new Error(`Unsupported LLM_PROVIDER: ${process.env.LLM_PROVIDER}`);
}

function normalizeOpenRouterProvider(provider: string): string | null {
  const normalizedProvider = provider.trim().toLowerCase();

  if (!normalizedProvider) {
    return null;
  }

  return (
    OPENROUTER_PROVIDER_ALIASES[
      normalizedProvider as keyof typeof OPENROUTER_PROVIDER_ALIASES
    ] ?? normalizedProvider.replace(/\s+/g, "-")
  );
}

function getOpenRouterProviderOrder(): string[] {
  const configuredOrder = process.env.OPENROUTER_PROVIDER_ORDER;

  if (!configuredOrder) {
    return [...DEFAULT_OPENROUTER_PROVIDER_ORDER];
  }

  const providerOrder = configuredOrder
    .split(",")
    .map(normalizeOpenRouterProvider)
    .filter((provider): provider is string => provider !== null);

  return providerOrder.length > 0
    ? Array.from(new Set(providerOrder))
    : [...DEFAULT_OPENROUTER_PROVIDER_ORDER];
}

function getOpenRouterRoute(): OpenRouterRoute {
  const route = process.env.OPENROUTER_ROUTE?.trim().toLowerCase();

  if (!route || route === "fallback") {
    return "fallback";
  }

  if (route === "cheapest") {
    return "cheapest";
  }

  throw new Error(`Unsupported OPENROUTER_ROUTE: ${process.env.OPENROUTER_ROUTE}`);
}

function getOpenRouterProviderPreferences(): OpenRouterProviderPreferences {
  if (getOpenRouterRoute() === "cheapest") {
    return { sort: "price" };
  }

  return {
    order: getOpenRouterProviderOrder(),
    allow_fallbacks: true,
  };
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

export function getAnthropicRequestOptions(
  requestBody: AnthropicMessageCreateParams,
): AnthropicRequestOptions | undefined {
  if (getLlmProvider() !== "openrouter") {
    return undefined;
  }

  return {
    body: {
      ...requestBody,
      provider: getOpenRouterProviderPreferences(),
    },
  };
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
