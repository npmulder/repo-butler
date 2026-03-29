import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  parseBotCommand,
  processWebhookDelivery,
  verifyWebhookSignature,
  type WebhookStore,
} from "../convex/lib/githubWebhooks";

type TestRepo = {
  fullName: string;
  id: string;
  userId: string;
};

type TestStore = WebhookStore<string, string, string, string, string> & {
  createdIssues: Array<{
    githubIssueNumber: bigint;
    labels: string[];
  }>;
  createdRuns: Array<{
    triggeredBy: string;
    githubIssueNumber: bigint;
  }>;
  recordedDeliveries: string[];
  scheduledRuns: Array<{ issueId: string; runId: string }>;
  suspendedInstallations: string[];
};

function buildPayload(overrides: {
  commentBody?: string;
  fullName?: string;
  issueState?: "open" | "closed";
  labels?: Array<{ name: string }>;
  installationId?: number;
} = {}) {
  return {
    repository: { full_name: overrides.fullName ?? "repo-butler/example" },
    issue: {
      number: 42,
      html_url: "https://github.com/repo-butler/example/issues/42",
      title: "Parser error",
      body: "Details",
      user: { login: "octocat" },
      labels: overrides.labels ?? [],
      state: overrides.issueState ?? "open",
      created_at: "2026-03-29T10:00:00Z",
    },
    ...(overrides.commentBody
      ? {
          comment: {
            body: overrides.commentBody,
          },
        }
      : {}),
    ...(overrides.installationId !== undefined
      ? {
          installation: {
            id: overrides.installationId,
          },
        }
      : {}),
  };
}

function createStore({
  eventTypes = ["issues.opened", "issues.labeled", "issue_comment.created"],
  duplicate = false,
  repoActive = true,
  installationExists = true,
}: {
  eventTypes?: string[];
  duplicate?: boolean;
  repoActive?: boolean;
  installationExists?: boolean;
} = {}): TestStore {
  const repo: TestRepo = {
    id: "repo_123",
    userId: "user_123",
    fullName: "repo-butler/example",
  };

  const store: TestStore = {
    createdIssues: [],
    createdRuns: [],
    recordedDeliveries: [],
    scheduledRuns: [],
    suspendedInstallations: [],
    hasDelivery: async () => duplicate,
    recordDelivery: async ({ deliveryId }) => {
      store.recordedDeliveries.push(deliveryId);
    },
    getActiveRepoByFullName: async (fullName) =>
      fullName === repo.fullName && repoActive ? repo : null,
    isEventTypeEnabled: async (_repoId, eventType) =>
      eventTypes.includes(eventType),
    createIssueSnapshot: async (input) => {
      store.createdIssues.push({
        githubIssueNumber: input.githubIssueNumber,
        labels: input.labels,
      });
      return {
        id: "issue_123",
        repoId: repo.id,
        githubIssueNumber: BigInt(42),
      };
    },
    createRun: async (input) => {
      store.createdRuns.push({
        triggeredBy: input.triggeredBy,
        githubIssueNumber: input.githubIssueNumber,
      });
      return `run_${store.createdRuns.length}`;
    },
    scheduleTriage: async (runId, issueId) => {
      store.scheduledRuns.push({ runId, issueId });
    },
    getInstallationByInstallationId: async (installationId) =>
      installationExists
        ? { id: "installation_123", installationId }
        : null,
    markInstallationSuspended: async (installationId) => {
      store.suspendedInstallations.push(installationId);
    },
  };

  return store;
}

describe("parseBotCommand", () => {
  it.each([
    ["@repobutler triage please", "triage"],
    ["Need help from @repobutler reproduce", "reproduce"],
    ["@repobutler STATUS", "status"],
  ] as const)("extracts %s -> %s", (commentBody, command) => {
    expect(parseBotCommand(commentBody)).toBe(command);
  });

  it("returns null for non-matching comments", () => {
    expect(parseBotCommand("Looks good to me")).toBeNull();
    expect(parseBotCommand("@someoneelse triage")).toBeNull();
  });
});

describe("verifyWebhookSignature", () => {
  it("accepts a valid HMAC signature", async () => {
    const rawBody = new TextEncoder().encode('{"hello":"world"}');
    const secret = "webhook-secret";
    const signature = `sha256=${createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex")}`;

    await expect(
      verifyWebhookSignature(rawBody, signature, secret),
    ).resolves.toBe(true);
  });

  it("rejects a tampered body", async () => {
    const originalBody = new TextEncoder().encode('{"hello":"world"}');
    const tamperedBody = new TextEncoder().encode('{"hello":"tampered"}');
    const secret = "webhook-secret";
    const signature = `sha256=${createHmac("sha256", secret)
      .update(originalBody)
      .digest("hex")}`;

    await expect(
      verifyWebhookSignature(tamperedBody, signature, secret),
    ).resolves.toBe(false);
  });

  it("rejects malformed signatures", async () => {
    const rawBody = new TextEncoder().encode('{"hello":"world"}');

    await expect(
      verifyWebhookSignature(rawBody, "sha1=bad", "webhook-secret"),
    ).resolves.toBe(false);
  });
});

describe("processWebhookDelivery", () => {
  it("creates an issue snapshot, run, and scheduled triage for issues.opened", async () => {
    const store = createStore();

    const result = await processWebhookDelivery(store, {
      deliveryId: "delivery_123",
      event: "issues",
      action: "opened",
      payload: buildPayload(),
    });

    expect(result).toEqual({ duplicate: false, dispatch: "issue_opened" });
    expect(store.createdIssues).toHaveLength(1);
    expect(store.createdRuns).toEqual([
      expect.objectContaining({ triggeredBy: "issue_opened" }),
    ]);
    expect(store.scheduledRuns).toEqual([{ issueId: "issue_123", runId: "run_1" }]);
    expect(store.recordedDeliveries).toEqual(["delivery_123"]);
  });

  it("triggers a run when the repro-me label is added", async () => {
    const store = createStore();

    const result = await processWebhookDelivery(store, {
      deliveryId: "delivery_456",
      event: "issues",
      action: "labeled",
      payload: buildPayload({
        labels: [{ name: "bug" }],
        installationId: 99,
        fullName: "repo-butler/example",
        issueState: "open",
      }),
    });

    expect(
      await processWebhookDelivery(store, {
        deliveryId: "delivery_457",
        event: "issues",
        action: "labeled",
        payload: {
          ...buildPayload({ labels: [{ name: "bug" }] }),
          label: { name: "repro-me" },
        },
      }),
    ).toEqual({ duplicate: false, dispatch: "repro_label" });
    expect(store.createdRuns.at(-1)).toEqual(
      expect.objectContaining({ triggeredBy: "label_added" }),
    );
    expect(result).toEqual({ duplicate: false, dispatch: "ignored" });
  });

  it.each([
    ["@repobutler triage", "comment_command"],
    ["@repobutler reproduce", "comment_command"],
  ] as const)(
    "triggers %s as a comment command",
    async (commentBody, dispatch) => {
      const store = createStore();

      const result = await processWebhookDelivery(store, {
        deliveryId: `delivery_${commentBody}`,
        event: "issue_comment",
        action: "created",
        payload: buildPayload({ commentBody }),
      });

      expect(result).toEqual({ duplicate: false, dispatch });
      expect(store.createdRuns).toEqual([
        expect.objectContaining({ triggeredBy: "comment_command" }),
      ]);
      expect(store.scheduledRuns).toEqual([{ issueId: "issue_123", runId: "run_1" }]);
    },
  );

  it("dispatches status commands without creating a run", async () => {
    const store = createStore();

    const result = await processWebhookDelivery(store, {
      deliveryId: "delivery_status",
      event: "issue_comment",
      action: "created",
      payload: buildPayload({ commentBody: "@repobutler status" }),
    });

    expect(result).toEqual({ duplicate: false, dispatch: "status_command" });
    expect(store.createdIssues).toHaveLength(0);
    expect(store.createdRuns).toHaveLength(0);
    expect(store.scheduledRuns).toHaveLength(0);
  });

  it("deduplicates repeated deliveries", async () => {
    const store = createStore({ duplicate: true });

    const result = await processWebhookDelivery(store, {
      deliveryId: "delivery_duplicate",
      event: "issues",
      action: "opened",
      payload: buildPayload(),
    });

    expect(result).toEqual({ duplicate: true, dispatch: "ignored" });
    expect(store.recordedDeliveries).toHaveLength(0);
    expect(store.createdRuns).toHaveLength(0);
  });

  it.each([
    [
      "unknown event type",
      createStore(),
      {
        deliveryId: "delivery_unknown",
        event: "pull_request",
        action: "opened",
        payload: buildPayload(),
      },
    ],
    [
      "missing repo",
      createStore(),
      {
        deliveryId: "delivery_missing_repo",
        event: "issues",
        action: "opened",
        payload: buildPayload({ fullName: "repo-butler/missing" }),
      },
    ],
    [
      "inactive repo",
      createStore({ repoActive: false }),
      {
        deliveryId: "delivery_inactive_repo",
        event: "issues",
        action: "opened",
        payload: buildPayload(),
      },
    ],
  ] as const)("ignores %s", async (_label, store, input) => {
    const result = await processWebhookDelivery(store, input);

    expect(result).toEqual({ duplicate: false, dispatch: "ignored" });
    expect(store.createdIssues).toHaveLength(0);
    expect(store.createdRuns).toHaveLength(0);
    expect(store.recordedDeliveries).toEqual([input.deliveryId]);
  });

  it.each(["deleted", "suspend"] as const)(
    "marks an installation suspended for installation/%s",
    async (action) => {
      const store = createStore();

      const result = await processWebhookDelivery(store, {
        deliveryId: `delivery_installation_${action}`,
        event: "installation",
        action,
        payload: buildPayload({ installationId: 101 }),
      });

      expect(result).toEqual({
        duplicate: false,
        dispatch: "installation_suspended",
      });
      expect(store.suspendedInstallations).toEqual(["installation_123"]);
      expect(store.recordedDeliveries).toEqual([
        `delivery_installation_${action}`,
      ]);
    },
  );
});
