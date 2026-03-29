import { afterEach, describe, expect, it } from "vitest";

import { redactEnvVars, redactSecrets } from "../lib/log-redactor";

const originalEnv = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }

  Object.assign(process.env, originalEnv);
});

describe("redactSecrets", () => {
  it("redacts supported secret formats", () => {
    const githubPat = `github_pat_${"a".repeat(22)}_${"b".repeat(59)}`;
    const privateKey = [
      "-----BEGIN PRIVATE KEY-----",
      "super-secret-private-key",
      "-----END PRIVATE KEY-----",
    ].join("\n");
    const input = [
      `GITHUB_TOKEN=${`ghp_${"1".repeat(36)}`}`,
      `secondary token ${`ghs_${"2".repeat(36)}`}`,
      `fallback ${githubPat}`,
      "anthropic sk-ant-secret-value",
      "Authorization: Bearer abc.def.ghi==",
      privateKey,
      "password=hunter2",
      "secret: hidden-value",
      "credential = local-only",
      "api_key=service-secret",
    ].join("\n");

    const redacted = redactSecrets(input);

    expect(redacted).not.toContain("ghp_");
    expect(redacted).not.toContain("ghs_");
    expect(redacted).not.toContain(githubPat);
    expect(redacted).not.toContain("sk-ant-secret-value");
    expect(redacted).not.toContain("Bearer abc.def.ghi==");
    expect(redacted).not.toContain("BEGIN PRIVATE KEY");
    expect(redacted).not.toContain("hunter2");
    expect(redacted).not.toContain("hidden-value");
    expect(redacted).not.toContain("local-only");
    expect(redacted).not.toContain("service-secret");
    expect(redacted).toContain("[REDACTED]");
  });

  it("returns unchanged text when nothing looks secret", () => {
    const input = "stdout: all checks passed with exit code 0";

    expect(redactSecrets(input)).toBe(input);
  });
});

describe("redactEnvVars", () => {
  it("redacts configured env var values and skips short or unset values", () => {
    process.env.LONG_SECRET = "super-secret-value";
    process.env.SHORT_SECRET = "abcd";
    delete process.env.MISSING_SECRET;

    const input = [
      "LONG_SECRET=super-secret-value",
      "SHORT_SECRET=abcd",
      "MISSING_SECRET is not present",
    ].join("\n");

    const redacted = redactEnvVars(input, [
      "LONG_SECRET",
      "SHORT_SECRET",
      "MISSING_SECRET",
    ]);

    expect(redacted).toContain("[LONG_SECRET:REDACTED]");
    expect(redacted).not.toContain("super-secret-value");
    expect(redacted).toContain("SHORT_SECRET=abcd");
    expect(redacted).toContain("MISSING_SECRET is not present");
  });
});
