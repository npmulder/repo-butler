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

    const { MODELS, getAnthropicClient } = await import("../lib/claude");
    const firstClient = getAnthropicClient();
    const secondClient = getAnthropicClient();

    expect(anthropicState.constructor).toHaveBeenCalledTimes(1);
    expect(anthropicState.constructor).toHaveBeenCalledWith({
      apiKey: "anthropic-key",
    });
    expect(MODELS).toEqual({
      triage: "claude-sonnet-4-20250514",
      reproduce: "claude-sonnet-4-20250514",
      verify: "claude-sonnet-4-20250514",
    });
    expect(secondClient).toBe(firstClient);
  });

  it("uses OpenRouter configuration when the provider is openrouter", async () => {
    vi.stubEnv("LLM_PROVIDER", "openrouter");
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key");
    vi.stubEnv(
      "NEXT_PUBLIC_WORKOS_REDIRECT_URI",
      "https://repo-butler.example.com/api/auth/callback",
    );

    const { MODELS, getAnthropicClient } = await import("../lib/claude");

    getAnthropicClient();

    expect(anthropicState.constructor).toHaveBeenCalledTimes(1);
    expect(anthropicState.constructor).toHaveBeenCalledWith({
      apiKey: "openrouter-key",
      baseURL: "https://openrouter.ai/api",
      defaultHeaders: {
        "HTTP-Referer": "https://repo-butler.example.com",
        "X-Title": "Repo Butler",
      },
    });
    expect(MODELS).toEqual({
      triage: "anthropic/claude-sonnet-4",
      reproduce: "anthropic/claude-sonnet-4",
      verify: "anthropic/claude-sonnet-4",
    });
  });

  it("falls back to Vercel host envs for the OpenRouter referer", async () => {
    vi.stubEnv("LLM_PROVIDER", "openrouter");
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key");
    vi.stubEnv("VERCEL_BRANCH_URL", "repo-butler-git-cv-142.vercel.app");

    const { getAnthropicClient } = await import("../lib/claude");

    getAnthropicClient();

    expect(anthropicState.constructor).toHaveBeenCalledWith({
      apiKey: "openrouter-key",
      baseURL: "https://openrouter.ai/api",
      defaultHeaders: {
        "HTTP-Referer": "https://repo-butler-git-cv-142.vercel.app",
        "X-Title": "Repo Butler",
      },
    });
  });
});
