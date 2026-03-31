import { describe, expect, it } from "vitest";

import {
  AuditEventType,
  createAuditEvent,
  redactSensitiveFields,
} from "../lib/security/audit-logger";
import {
  checkRateLimit,
  type RateLimitStore,
} from "../lib/security/rate-limiter";
import {
  redactSecrets,
  scanForSecrets,
} from "../lib/security/secret-scanner";
import { validateSandboxRequest } from "../lib/security/token-isolation";

class InMemoryRateLimitStore implements RateLimitStore {
  readonly events: Array<{ key: string; timestamp: number }>;

  constructor(initialEvents: Array<{ key: string; timestamp: number }> = []) {
    this.events = [...initialEvents];
  }

  async listEventsSince(key: string, since: number, limit: number) {
    return this.events
      .filter((event) => event.key === key && event.timestamp >= since)
      .sort((left, right) => left.timestamp - right.timestamp)
      .slice(0, limit)
      .map(({ timestamp }) => ({ timestamp }));
  }

  async insertEvent(event: { key: string; timestamp: number }) {
    this.events.push(event);
  }
}

describe("validateSandboxRequest", () => {
  it.each([
    [
      "GitHub PAT",
      {
        repo: { cloneUrl: "https://github.com/acme/repo.git" },
        payload: `ghp_${"a".repeat(36)}`,
      },
    ],
    [
      "GitHub App token",
      {
        repo: { cloneUrl: "https://github.com/acme/repo.git" },
        payload: `ghs_${"b".repeat(36)}`,
      },
    ],
    [
      "Anthropic key",
      {
        repo: { cloneUrl: "https://github.com/acme/repo.git" },
        payload: `sk-ant-${"c".repeat(24)}`,
      },
    ],
    [
      "Private key",
      {
        repo: { cloneUrl: "https://github.com/acme/repo.git" },
        payload: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
      },
    ],
  ])("detects %s in sandbox requests", (_label, request) => {
    const result = validateSandboxRequest(request);

    expect(result.safe).toBe(false);
    expect(result.violations).not.toHaveLength(0);
  });

  it("rejects clone URLs with embedded credentials", () => {
    const result = validateSandboxRequest({
      repo: {
        cloneUrl: `https://x-access-token:ghs_${"d".repeat(36)}@github.com/acme/repo.git`,
      },
    });

    expect(result.safe).toBe(false);
    expect(result.violations).toContain("Clone URL contains embedded credentials");
  });
});

describe("secret scanning", () => {
  it("detects supported secret patterns", () => {
    const content = [
      `token one ghp_${"1".repeat(36)}`,
      `token two ghs_${"2".repeat(36)}`,
      `anthropic sk-ant-${"3".repeat(24)}`,
      "aws AKIA1234567890ABCDEF",
      "-----BEGIN PRIVATE KEY-----",
      "password=\"hunter2hunter2\"",
    ].join("\n");
    const result = scanForSecrets(content, "unit:test");
    const findingTypes = result.findings.map((finding) => finding.type);

    expect(result.clean).toBe(false);
    expect(findingTypes).toContain("GitHub PAT");
    expect(findingTypes).toContain("GitHub App token");
    expect(findingTypes).toContain("Anthropic API key");
    expect(findingTypes).toContain("AWS access key");
    expect(findingTypes).toContain("Private key");
    expect(findingTypes).toContain("Generic secret assignment");
  });

  it("does not match keywords embedded inside longer identifiers", () => {
    const content = 'monkey="harmlessvalue"\nturnkey="still-fine"';
    const result = scanForSecrets(content, "unit:test");

    expect(result.clean).toBe(true);
    expect(result.findings).toEqual([]);
    expect(redactSecrets(content)).toBe(content);
  });

  it("redacts discovered secrets", () => {
    const input = [
      `ghp_${"e".repeat(36)}`,
      `ghs_${"f".repeat(36)}`,
      `sk-ant-${"g".repeat(24)}`,
      "AKIA1234567890ABCDEF",
      "password=\"hunter2hunter2\"",
    ].join("\n");

    const redacted = redactSecrets(input);

    expect(redacted).toContain("[REDACTED]");
    expect(redacted).not.toContain("ghp_");
    expect(redacted).not.toContain("ghs_");
    expect(redacted).not.toContain("sk-ant-");
    expect(redacted).not.toContain("AKIA1234567890ABCDEF");
    expect(redacted).not.toContain("hunter2hunter2");
  });
});

describe("audit logging", () => {
  it("redacts sensitive detail keys recursively", () => {
    const redacted = redactSensitiveFields({
      apiToken: "secret-token",
      key: "webhookIngestion:global",
      rateLimitKey: "triagePerRepo:repo_123",
      nested: {
        webhookSecret: "value",
        allowed: "safe",
      },
      array: [{ privateKey: "value" }],
    });

    expect(redacted).toEqual({
      apiToken: "[REDACTED]",
      key: "webhookIngestion:global",
      rateLimitKey: "triagePerRepo:repo_123",
      nested: {
        webhookSecret: "[REDACTED]",
        allowed: "safe",
      },
      array: [{ privateKey: "[REDACTED]" }],
    });
  });

  it("creates critical events with redacted details", () => {
    const event = createAuditEvent(
      AuditEventType.SECRET_DETECTED,
      "system",
      { type: "run", id: "run_123" },
      { secretValue: "abc123", note: "found in stderr" },
    );

    expect(event.severity).toBe("critical");
    expect(event.details).toEqual({
      secretValue: "[REDACTED]",
      note: "found in stderr",
    });
  });
});

describe("rate limiting", () => {
  it("allows requests under the configured limit", async () => {
    const store = new InMemoryRateLimitStore();

    const result = await checkRateLimit(
      store,
      "triagePerRepo:repo_123",
      { maxRequests: 2, windowMs: 1_000 },
      10_000,
    );

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
    expect(store.events).toEqual([
      { key: "triagePerRepo:repo_123", timestamp: 10_000 },
    ]);
  });

  it("blocks requests once the configured limit is reached", async () => {
    const store = new InMemoryRateLimitStore([
      { key: "triagePerRepo:repo_123", timestamp: 9_100 },
      { key: "triagePerRepo:repo_123", timestamp: 9_500 },
    ]);

    const result = await checkRateLimit(
      store,
      "triagePerRepo:repo_123",
      { maxRequests: 2, windowMs: 1_000 },
      10_000,
    );

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.resetAt).toBe(10_100);
    expect(store.events).toHaveLength(2);
  });

  it("resets the window after older events expire", async () => {
    const store = new InMemoryRateLimitStore([
      { key: "triagePerRepo:repo_123", timestamp: 7_000 },
    ]);

    const result = await checkRateLimit(
      store,
      "triagePerRepo:repo_123",
      { maxRequests: 2, windowMs: 1_000 },
      10_000,
    );

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
    expect(result.resetAt).toBe(11_000);
    expect(store.events).toEqual([
      { key: "triagePerRepo:repo_123", timestamp: 7_000 },
      { key: "triagePerRepo:repo_123", timestamp: 10_000 },
    ]);
  });
});
