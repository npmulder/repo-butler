import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  processWebhookDelivery,
  verifyWebhookSignature,
  type WebhookStore,
} from "../convex/lib/githubWebhooks";

type RepoRecord = {
  id: string;
  userId: string;
  fullName: string;
  isActive: boolean;
};

type IssueRecord = {
  id: string;
  repoId: string;
  githubIssueNumber: bigint;
  title: string;
  labels: string[];
};

type RunRecord = {
  id: string;
  issueId: string;
  repoId: string;
  triggeredBy: "issue_opened" | "label_added" | "comment_command";
};

type InstallationRecord = {
  id: string;
  installationId: bigint;
  suspendedAt?: number;
};

type MemoryState = {
  deliveries: Array<{
    deliveryId: string;
    event: string;
    action: string;
    processedAt: number;
  }>;
  repos: RepoRecord[];
  issues: IssueRecord[];
  runs: RunRecord[];
  scheduledRunIds: string[];
  installations: InstallationRecord[];
};

function createMemoryStore(state: MemoryState): WebhookStore<
  string,
  string,
  string,
  string,
  string
> {
  return {
    hasDelivery: async (deliveryId) =>
      state.deliveries.some((delivery) => delivery.deliveryId === deliveryId),
    recordDelivery: async (delivery) => {
      state.deliveries.push(delivery);
    },
    getActiveRepoByFullName: async (fullName) => {
      const repo = state.repos.find(
        (candidate) => candidate.fullName === fullName && candidate.isActive,
      );

      return repo
        ? { id: repo.id, userId: repo.userId, fullName: repo.fullName }
        : null;
    },
    isEventTypeEnabled: async () => true,
    createIssueSnapshot: async (input) => {
      const issue: IssueRecord = {
        id: `issue_${state.issues.length + 1}`,
        repoId: input.repoId,
        githubIssueNumber: input.githubIssueNumber,
        title: input.title,
        labels: input.labels,
      };

      state.issues.push(issue);
      return {
        id: issue.id,
        repoId: issue.repoId,
        githubIssueNumber: issue.githubIssueNumber,
      };
    },
    createRun: async ({ issueId, repo, triggeredBy }) => {
      const run: RunRecord = {
        id: `run_${state.runs.length + 1}`,
        issueId,
        repoId: repo.id,
        triggeredBy,
      };

      state.runs.push(run);
      return run.id;
    },
    scheduleTriage: async (runId) => {
      state.scheduledRunIds.push(runId);
    },
    getInstallationByInstallationId: async (installationId) => {
      const installation = state.installations.find(
        (candidate) => candidate.installationId === installationId,
      );

      return installation
        ? {
            id: installation.id,
            installationId: installation.installationId,
          }
        : null;
    },
    markInstallationSuspended: async (installationId, suspendedAt) => {
      const installation = state.installations.find(
        (candidate) => candidate.id === installationId,
      );

      if (installation) {
        installation.suspendedAt = suspendedAt;
      }
    },
  };
}

function createBaseState(overrides?: Partial<MemoryState>): MemoryState {
  return {
    deliveries: [],
    repos: [
      {
        id: "repo_1",
        userId: "user_1",
        fullName: "octo/repo",
        isActive: true,
      },
      {
        id: "repo_2",
        userId: "user_2",
        fullName: "octo/inactive",
        isActive: false,
      },
    ],
    issues: [],
    runs: [],
    scheduledRunIds: [],
    installations: [{ id: "inst_1", installationId: BigInt(99) }],
    ...overrides,
  };
}

function createIssuePayload(action: string, repoFullName = "octo/repo") {
  return {
    action,
    repository: { full_name: repoFullName },
    issue: {
      number: 42,
      html_url: `https://github.com/${repoFullName}/issues/42`,
      title: "Webhook issue",
      body: "Steps to reproduce",
      user: { login: "alice" },
      labels: [{ name: "bug" }],
      state: "open",
    },
  };
}

async function testSignatureVerification() {
  const payload = JSON.stringify(createIssuePayload("opened"));
  const signature = `sha256=${createHmac("sha256", "whsec_test")
    .update(payload)
    .digest("hex")}`;

  const isValid = await verifyWebhookSignature(
    new TextEncoder().encode(payload),
    signature,
    "whsec_test",
  );
  const isInvalid = await verifyWebhookSignature(
    new TextEncoder().encode(payload),
    "sha256=deadbeef",
    "whsec_test",
  );

  assert.equal(isValid, true, "expected valid signature to verify");
  assert.equal(isInvalid, false, "expected invalid signature to be rejected");
}

async function testIdempotency() {
  const state = createBaseState();
  const store = createMemoryStore(state);
  const payload = createIssuePayload("opened");

  const first = await processWebhookDelivery(store, {
    deliveryId: "delivery-1",
    event: "issues",
    action: "opened",
    payload,
  });
  const second = await processWebhookDelivery(store, {
    deliveryId: "delivery-1",
    event: "issues",
    action: "opened",
    payload,
  });

  assert.equal(first.duplicate, false, "first delivery should be processed");
  assert.equal(second.duplicate, true, "second delivery should be skipped");
  assert.equal(state.deliveries.length, 1, "delivery should only be recorded once");
  assert.equal(state.runs.length, 1, "duplicate delivery must not create a second run");
}

async function testIssueOpened() {
  const state = createBaseState();
  const result = await processWebhookDelivery(createMemoryStore(state), {
    deliveryId: "delivery-2",
    event: "issues",
    action: "opened",
    payload: createIssuePayload("opened"),
  });

  assert.equal(result.dispatch, "issue_opened");
  assert.equal(state.issues.length, 1, "issue should be snapshotted");
  assert.equal(state.runs.length, 1, "run should be created");
  assert.equal(state.runs[0]?.triggeredBy, "issue_opened");
  assert.deepEqual(state.scheduledRunIds, ["run_1"]);
}

async function testReproLabel() {
  const state = createBaseState();
  const payload = {
    ...createIssuePayload("labeled"),
    label: { name: "repro-me" },
  };

  const result = await processWebhookDelivery(createMemoryStore(state), {
    deliveryId: "delivery-3",
    event: "issues",
    action: "labeled",
    payload,
  });

  assert.equal(result.dispatch, "repro_label");
  assert.equal(state.runs[0]?.triggeredBy, "label_added");
}

async function testBotCommand() {
  const state = createBaseState();
  const payload = {
    ...createIssuePayload("created"),
    comment: { body: "@repobutler triage" },
  };

  const result = await processWebhookDelivery(createMemoryStore(state), {
    deliveryId: "delivery-4",
    event: "issue_comment",
    action: "created",
    payload,
  });

  assert.equal(result.dispatch, "comment_command");
  assert.equal(state.runs[0]?.triggeredBy, "comment_command");
  assert.equal(state.issues.length, 1, "command should snapshot current issue context");
}

async function testStatusCommandRequiresActiveRepo() {
  const inactiveState = createBaseState();
  const inactiveResult = await processWebhookDelivery(
    createMemoryStore(inactiveState),
    {
      deliveryId: "delivery-4b",
      event: "issue_comment",
      action: "created",
      payload: {
        ...createIssuePayload("created", "octo/inactive"),
        comment: { body: "@repobutler status" },
      },
    },
  );

  assert.equal(
    inactiveResult.dispatch,
    "ignored",
    "status command should be ignored for inactive repos",
  );

  const activeState = createBaseState();
  const activeResult = await processWebhookDelivery(createMemoryStore(activeState), {
    deliveryId: "delivery-4c",
    event: "issue_comment",
    action: "created",
    payload: {
      ...createIssuePayload("created"),
      comment: { body: "@repobutler status" },
    },
  });

  assert.equal(
    activeResult.dispatch,
    "status_command",
    "status command should dispatch for active repos",
  );
  assert.equal(activeState.runs.length, 0, "status command must not create a run");
}

async function testInactiveRepoIgnored() {
  const state = createBaseState();
  const result = await processWebhookDelivery(createMemoryStore(state), {
    deliveryId: "delivery-5",
    event: "issues",
    action: "opened",
    payload: createIssuePayload("opened", "octo/inactive"),
  });

  assert.equal(result.dispatch, "ignored");
  assert.equal(state.issues.length, 0, "inactive repo should not create snapshots");
  assert.equal(state.runs.length, 0, "inactive repo should not create runs");
  assert.equal(state.deliveries.length, 1, "ignored deliveries should still be recorded");
}

async function testInstallationSuspend() {
  const state = createBaseState();
  const result = await processWebhookDelivery(createMemoryStore(state), {
    deliveryId: "delivery-6",
    event: "installation",
    action: "suspend",
    payload: {
      action: "suspend",
      installation: { id: 99 },
    },
  });

  assert.equal(result.dispatch, "installation_suspended");
  assert.equal(
    typeof state.installations[0]?.suspendedAt,
    "number",
    "installation should be marked suspended",
  );
}

async function main() {
  await testSignatureVerification();
  await testIdempotency();
  await testIssueOpened();
  await testReproLabel();
  await testBotCommand();
  await testStatusCommandRequiresActiveRepo();
  await testInactiveRepoIgnored();
  await testInstallationSuspend();

  console.log("github webhook tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
