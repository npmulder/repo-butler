import { beforeEach, describe, expect, it, vi } from "vitest";

const anthropicState = vi.hoisted(() => {
  const constructor = vi.fn(function MockAnthropic(
    this: { config: unknown },
    config: unknown,
  ) {
    this.config = config;
  });

  return { constructor };
});

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: anthropicState.constructor,
  };
});

beforeEach(() => {
  anthropicState.constructor.mockClear();
  vi.resetModules();
  vi.unstubAllEnvs();
});

function buildRequestBody() {
  return {
    model: "claude-sonnet-4-20250514",
    max_tokens: 64,
    messages: [{ role: "user" as const, content: "Hello" }],
  };
}

describe("getAnthropicClient", () => {
  it("defaults to direct Anthropic when no provider is configured", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-key");

    const { getAnthropicClient } = await import("../lib/claude");
    const firstClient = getAnthropicClient();
    const secondClient = getAnthropicClient();

    expect(anthropicState.constructor).toHaveBeenCalledTimes(1);
    expect(anthropicState.constructor).toHaveBeenCalledWith({
      apiKey: "anthropic-key",
    });
    expect(secondClient).toBe(firstClient);
  });

  it("uses OpenRouter configuration when the provider is openrouter", async () => {
    vi.stubEnv("LLM_PROVIDER", "openrouter");
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key");

    const { getAnthropicClient } = await import("../lib/claude");

    getAnthropicClient();

    expect(anthropicState.constructor).toHaveBeenCalledTimes(1);
    expect(anthropicState.constructor).toHaveBeenCalledWith({
      apiKey: "openrouter-key",
      baseURL: "https://openrouter.ai/api",
    });
  });
});

describe("getAnthropicRequestOptions", () => {
  it("defaults OpenRouter routing to Anthropic-first fallbacks", async () => {
    vi.stubEnv("LLM_PROVIDER", "openrouter");

    const { getAnthropicRequestOptions } = await import("../lib/claude");
    const requestBody = buildRequestBody();

    expect(getAnthropicRequestOptions(requestBody)).toEqual({
      body: {
        ...requestBody,
        provider: {
          order: ["anthropic", "amazon-bedrock", "google-vertex"],
          allow_fallbacks: true,
        },
      },
    });
  });

  it("normalizes configured provider order names into OpenRouter slugs", async () => {
    vi.stubEnv("LLM_PROVIDER", "openrouter");
    vi.stubEnv("OPENROUTER_PROVIDER_ORDER", "Anthropic,Amazon Bedrock,Google");

    const { getAnthropicRequestOptions } = await import("../lib/claude");
    const requestBody = buildRequestBody();

    expect(getAnthropicRequestOptions(requestBody)).toEqual({
      body: {
        ...requestBody,
        provider: {
          order: ["anthropic", "amazon-bedrock", "google-vertex"],
          allow_fallbacks: true,
        },
      },
    });
  });

  it("switches OpenRouter routing to price sorting in cheapest mode", async () => {
    vi.stubEnv("LLM_PROVIDER", "openrouter");
    vi.stubEnv("OPENROUTER_ROUTE", "cheapest");

    const { getAnthropicRequestOptions } = await import("../lib/claude");
    const requestBody = buildRequestBody();

    expect(getAnthropicRequestOptions(requestBody)).toEqual({
      body: {
        ...requestBody,
        provider: {
          sort: "price",
        },
      },
    });
  });

  it("has no effect when the direct Anthropic provider is active", async () => {
    vi.stubEnv("LLM_PROVIDER", "anthropic");
    vi.stubEnv("OPENROUTER_PROVIDER_ORDER", "Anthropic,Amazon Bedrock,Google");
    vi.stubEnv("OPENROUTER_ROUTE", "cheapest");

    const { getAnthropicRequestOptions } = await import("../lib/claude");

    expect(getAnthropicRequestOptions(buildRequestBody())).toBeUndefined();
  });
});
