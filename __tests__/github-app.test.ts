import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe("GitHub install state helpers", () => {
  it("returns false instead of throwing when the client secret is missing", async () => {
    const { validateGitHubInstallState } = await import("../lib/githubApp");
    const payload = Buffer.from(
      JSON.stringify({
        exp: Math.floor(Date.now() / 1000) + 60,
        nonce: "install-nonce",
        sub: "user_123",
      }),
    ).toString("base64url");

    expect(
      validateGitHubInstallState(
        `${payload}.invalid-signature`,
        "user_123",
        "install-nonce",
      ),
    ).toBe(false);
  });

  it("accepts a state generated with the configured client secret", async () => {
    vi.stubEnv("GITHUB_APP_CLIENT_SECRET", "test-client-secret");

    const { createGitHubInstallState, validateGitHubInstallState } = await import(
      "../lib/githubApp"
    );
    const state = createGitHubInstallState("user_123", "install-nonce");

    expect(
      validateGitHubInstallState(state, "user_123", "install-nonce"),
    ).toBe(true);
    expect(validateGitHubInstallState(state, "user_123", "wrong-nonce")).toBe(
      false,
    );
  });
});
