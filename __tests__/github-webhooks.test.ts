import { describe, expect, it } from "vitest";

import {
  processWebhookDelivery,
  type WebhookStore,
} from "../convex/lib/githubWebhooks";

type TestRepo = {
  fullName: string;
  id: string;
  userId: string;
};

type TestStore = WebhookStore<string, string, string, string, string> & {
  createdIssues: number;
  createdRuns: number;
};

function createStore(eventTypes: string[]): TestStore {
  const repo: TestRepo = {
    id: "repo_123",
    userId: "user_123",
    fullName: "repo-butler/example",
  };

  const store: TestStore = {
    createdIssues: 0,
    createdRuns: 0,
    hasDelivery: async () => false,
    recordDelivery: async () => undefined,
    getActiveRepoByFullName: async (fullName) =>
      fullName === repo.fullName ? repo : null,
    isEventTypeEnabled: async (_repoId, eventType) =>
      eventTypes.includes(eventType),
    createIssueSnapshot: async () => {
      store.createdIssues += 1;
      return {
        id: "issue_123",
        repoId: repo.id,
        githubIssueNumber: BigInt(42),
      };
    },
    createRun: async () => {
      store.createdRuns += 1;
      return "run_123";
    },
    scheduleTriage: async () => undefined,
    getInstallationByInstallationId: async () => null,
    markInstallationSuspended: async () => undefined,
  };

  return store;
}

describe("processWebhookDelivery", () => {
  it("ignores issue-opened events when that source is disabled", async () => {
    const store = createStore(["issues.labeled"]);

    const result = await processWebhookDelivery(store, {
      deliveryId: "delivery_123",
      event: "issues",
      action: "opened",
      payload: {
        repository: { full_name: "repo-butler/example" },
        issue: {
          number: 42,
          html_url: "https://github.com/repo-butler/example/issues/42",
          title: "Parser error",
          body: "Details",
          user: { login: "octocat" },
          state: "open",
        },
      },
    });

    expect(result).toEqual({ duplicate: false, dispatch: "ignored" });
    expect(store.createdIssues).toBe(0);
    expect(store.createdRuns).toBe(0);
  });

  it("ignores comment commands when issue_comment events are disabled", async () => {
    const store = createStore(["issues.opened"]);

    const result = await processWebhookDelivery(store, {
      deliveryId: "delivery_456",
      event: "issue_comment",
      action: "created",
      payload: {
        repository: { full_name: "repo-butler/example" },
        issue: {
          number: 42,
          html_url: "https://github.com/repo-butler/example/issues/42",
          title: "Parser error",
          body: "Details",
          user: { login: "octocat" },
          state: "open",
        },
        comment: {
          body: "@repobutler triage",
        },
      },
    });

    expect(result).toEqual({ duplicate: false, dispatch: "ignored" });
    expect(store.createdIssues).toBe(0);
    expect(store.createdRuns).toBe(0);
  });
});
