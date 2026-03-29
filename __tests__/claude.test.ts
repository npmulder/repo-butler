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
