import { describe, expect, it } from "vitest";

import { internal } from "@/convex/_generated/api";
import { WEBHOOK_DELIVERY_RETENTION_MS } from "@/convex/webhooks";
import {
  createTestConvex,
  seedInstallation,
  seedRepo,
  seedRepoSettings,
  seedUser,
} from "@/test-support/convex/testHelpers";

function buildWebhookPayload(
  overrides: {
    commentBody?: string;
    fullName?: string;
    labelName?: string;
    installationId?: bigint;
  } = {},
) {
  return {
    repository: {
      full_name: overrides.fullName ?? "repo-butler/example",
    },
    issue: {
      number: 42,
      html_url: "https://github.com/repo-butler/example/issues/42",
      title: "Parser crash",
      body: "Fails on empty YAML input.",
      user: { login: "octocat" },
      labels: [],
      state: "open",
      created_at: "2026-03-29T10:00:00.000Z",
    },
    ...(overrides.commentBody
      ? {
          comment: {
            body: overrides.commentBody,
          },
        }
      : {}),
    ...(overrides.labelName
      ? {
          label: {
            name: overrides.labelName,
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

describe("webhooks.processWebhook", () => {
  it("processes issues/opened by creating a snapshot, run, and scheduled triage", async () => {
    const t = createTestConvex();
    const { userId } = await seedUser(t);
    const installationId = await seedInstallation(t, userId, BigInt(1001));
    const { repoId } = await seedRepo(t, { userId, installationId });

    const result = await t.mutation(internal.webhooks.processWebhook, {
      deliveryId: "delivery_opened",
      event: "issues",
      action: "opened",
      payload: buildWebhookPayload(),
    });

    expect(result).toEqual({ duplicate: false, dispatch: "issue_opened" });

    const { issues, runs, delivery } = await t.run(async (ctx) => {
      return {
        issues: await ctx.db
          .query("issues")
          .withIndex("by_repo", (q) => q.eq("repoId", repoId))
          .collect(),
        runs: await ctx.db
          .query("runs")
          .withIndex("by_repo", (q) => q.eq("repoId", repoId))
          .collect(),
        delivery: await ctx.db
          .query("webhookDeliveries")
          .withIndex("by_delivery_id", (q) =>
            q.eq("deliveryId", "delivery_opened"),
          )
          .unique(),
      };
    });

    expect(issues).toHaveLength(1);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      triggeredBy: "issue_opened",
      status: "pending",
      issueId: issues[0]._id,
      repoId,
    });
    expect(delivery).toMatchObject({
      deliveryId: "delivery_opened",
      event: "issues",
      action: "opened",
    });
  });

  it("triggers a run for issues/labeled with the repro-me label", async () => {
    const t = createTestConvex();
    const { userId } = await seedUser(t);
    const installationId = await seedInstallation(t, userId, BigInt(1002));
    const { repoId } = await seedRepo(t, { userId, installationId });

    const result = await t.mutation(internal.webhooks.processWebhook, {
      deliveryId: "delivery_label",
      event: "issues",
      action: "labeled",
      payload: buildWebhookPayload({ labelName: "repro-me" }),
    });

    expect(result).toEqual({ duplicate: false, dispatch: "repro_label" });

    const runs = await t.run(async (ctx) => {
      return await ctx.db
        .query("runs")
        .withIndex("by_repo", (q) => q.eq("repoId", repoId))
        .collect();
    });

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ triggeredBy: "label_added" });
  });

  it.each([
    ["@repobutler triage", "comment_command"],
    ["@repobutler reproduce", "comment_command"],
  ] as const)(
    "triggers %s via issue_comment/created",
    async (commentBody, dispatch) => {
      const t = createTestConvex();
      const { userId } = await seedUser(t);
      const installationId = await seedInstallation(t, userId);
      const { repoId } = await seedRepo(t, { userId, installationId });

      const result = await t.mutation(internal.webhooks.processWebhook, {
        deliveryId: `delivery_${dispatch}_${commentBody.replace(/\s+/g, "_")}`,
        event: "issue_comment",
        action: "created",
        payload: buildWebhookPayload({ commentBody }),
      });

      expect(result).toEqual({ duplicate: false, dispatch });

      const runs = await t.run(async (ctx) => {
        return await ctx.db
          .query("runs")
          .withIndex("by_repo", (q) => q.eq("repoId", repoId))
          .collect();
      });

      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ triggeredBy: "comment_command" });
    },
  );

  it("dispatches status commands without creating a run", async () => {
    const t = createTestConvex();
    const { userId } = await seedUser(t);
    const installationId = await seedInstallation(t, userId);
    const { repoId } = await seedRepo(t, { userId, installationId });

    const result = await t.mutation(internal.webhooks.processWebhook, {
      deliveryId: "delivery_status",
      event: "issue_comment",
      action: "created",
      payload: buildWebhookPayload({ commentBody: "@repobutler status" }),
    });

    expect(result).toEqual({ duplicate: false, dispatch: "status_command" });

    const runs = await t.run(async (ctx) => {
      return await ctx.db
        .query("runs")
        .withIndex("by_repo", (q) => q.eq("repoId", repoId))
        .collect();
    });

    expect(runs).toHaveLength(0);
  });

  it("deduplicates repeated deliveries within the retention window", async () => {
    const t = createTestConvex();
    const { userId } = await seedUser(t);
    const installationId = await seedInstallation(t, userId);
    await seedRepo(t, { userId, installationId });

    await t.mutation(internal.webhooks.processWebhook, {
      deliveryId: "delivery_duplicate",
      event: "issues",
      action: "opened",
      payload: buildWebhookPayload(),
    });

    const second = await t.mutation(internal.webhooks.processWebhook, {
      deliveryId: "delivery_duplicate",
      event: "issues",
      action: "opened",
      payload: buildWebhookPayload(),
    });

    expect(second).toEqual({ duplicate: true, dispatch: "ignored" });

    const { deliveries, runs } = await t.run(async (ctx) => {
      return {
        deliveries: await ctx.db
          .query("webhookDeliveries")
          .withIndex("by_delivery_id", (q) =>
            q.eq("deliveryId", "delivery_duplicate"),
          )
          .collect(),
        runs: await ctx.db.query("runs").collect(),
      };
    });

    expect(deliveries).toHaveLength(1);
    expect(runs).toHaveLength(1);
  });

  it("reprocesses a delivery after the retention window expires", async () => {
    const t = createTestConvex();
    const { userId } = await seedUser(t);
    const installationId = await seedInstallation(t, userId);
    await seedRepo(t, { userId, installationId });

    await t.mutation(internal.webhooks.processWebhook, {
      deliveryId: "delivery_expired",
      event: "issues",
      action: "opened",
      payload: buildWebhookPayload(),
    });

    const expiredProcessedAt = await t.run(async (ctx) => {
      const delivery = await ctx.db
        .query("webhookDeliveries")
        .withIndex("by_delivery_id", (q) =>
          q.eq("deliveryId", "delivery_expired"),
        )
        .unique();

      if (!delivery) {
        throw new Error("expected seeded webhook delivery");
      }

      const processedAt = Date.now() - WEBHOOK_DELIVERY_RETENTION_MS - 1_000;
      await ctx.db.patch(delivery._id, { processedAt });
      return processedAt;
    });

    const second = await t.mutation(internal.webhooks.processWebhook, {
      deliveryId: "delivery_expired",
      event: "issues",
      action: "opened",
      payload: buildWebhookPayload(),
    });

    expect(second).toEqual({ duplicate: false, dispatch: "issue_opened" });

    const { deliveries, runs } = await t.run(async (ctx) => {
      return {
        deliveries: await ctx.db
          .query("webhookDeliveries")
          .withIndex("by_delivery_id", (q) =>
            q.eq("deliveryId", "delivery_expired"),
          )
          .collect(),
        runs: await ctx.db.query("runs").collect(),
      };
    });

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].processedAt).toBeGreaterThan(expiredProcessedAt);
    expect(runs).toHaveLength(2);
  });

  it("cleans up expired deliveries without deleting active ones", async () => {
    const t = createTestConvex();
    const cutoffTime = Date.now() - WEBHOOK_DELIVERY_RETENTION_MS;

    await t.run(async (ctx) => {
      await ctx.db.insert("webhookDeliveries", {
        deliveryId: "delivery_active",
        event: "issues",
        action: "opened",
        processedAt: cutoffTime + 60_000,
      });
      await ctx.db.insert("webhookDeliveries", {
        deliveryId: "delivery_expired_a",
        event: "issues",
        action: "opened",
        processedAt: cutoffTime - 60_000,
      });
      await ctx.db.insert("webhookDeliveries", {
        deliveryId: "delivery_expired_b",
        event: "issues",
        action: "opened",
        processedAt: cutoffTime - 120_000,
      });
    });

    const firstPass = await t.mutation(
      internal.webhooks.cleanupExpiredDeliveries,
      {
        batchSize: 1,
        cutoffTime,
        scheduleContinuation: false,
      },
    );

    expect(firstPass).toEqual({
      cutoffTime,
      deletedCount: 1,
      hasMore: true,
    });

    const secondPass = await t.mutation(
      internal.webhooks.cleanupExpiredDeliveries,
      {
        batchSize: 10,
        cutoffTime,
        scheduleContinuation: false,
      },
    );

    expect(secondPass).toEqual({
      cutoffTime,
      deletedCount: 1,
      hasMore: false,
    });

    const remainingDeliveries = await t.run(async (ctx) => {
      return await ctx.db.query("webhookDeliveries").collect();
    });

    expect(remainingDeliveries).toEqual([
      expect.objectContaining({
        deliveryId: "delivery_active",
      }),
    ]);
  });

  it.each([
    [
      "unknown event type",
      async () => {
        const t = createTestConvex();
        const { userId } = await seedUser(t);
        const installationId = await seedInstallation(t, userId);
        await seedRepo(t, { userId, installationId });
        const result = await t.mutation(internal.webhooks.processWebhook, {
          deliveryId: "delivery_unknown",
          event: "pull_request",
          action: "opened",
          payload: buildWebhookPayload(),
        });
        const runs = await t.run(
          async (ctx) => await ctx.db.query("runs").collect(),
        );
        expect(result).toEqual({ duplicate: false, dispatch: "ignored" });
        expect(runs).toHaveLength(0);
      },
    ],
    [
      "missing repo",
      async () => {
        const t = createTestConvex();
        const result = await t.mutation(internal.webhooks.processWebhook, {
          deliveryId: "delivery_missing_repo",
          event: "issues",
          action: "opened",
          payload: buildWebhookPayload({ fullName: "repo-butler/missing" }),
        });
        const runs = await t.run(
          async (ctx) => await ctx.db.query("runs").collect(),
        );
        expect(result).toEqual({ duplicate: false, dispatch: "ignored" });
        expect(runs).toHaveLength(0);
      },
    ],
    [
      "inactive repo",
      async () => {
        const t = createTestConvex();
        const { userId } = await seedUser(t);
        const installationId = await seedInstallation(t, userId);
        await seedRepo(t, {
          userId,
          installationId,
          isActive: false,
        });
        const result = await t.mutation(internal.webhooks.processWebhook, {
          deliveryId: "delivery_inactive_repo",
          event: "issues",
          action: "opened",
          payload: buildWebhookPayload(),
        });
        const runs = await t.run(
          async (ctx) => await ctx.db.query("runs").collect(),
        );
        expect(result).toEqual({ duplicate: false, dispatch: "ignored" });
        expect(runs).toHaveLength(0);
      },
    ],
  ] as const)("ignores %s", async (_label, runAssertion) => {
    await runAssertion();
  });

  it.each(["deleted", "suspend"] as const)(
    "marks installations suspended for installation/%s",
    async (action) => {
      const t = createTestConvex();
      const { userId } = await seedUser(t);
      const installationId = await seedInstallation(t, userId, BigInt(2024));
      await seedRepo(t, { userId, installationId });

      const result = await t.mutation(internal.webhooks.processWebhook, {
        deliveryId: `delivery_installation_${action}`,
        event: "installation",
        action,
        payload: buildWebhookPayload({ installationId: BigInt(2024) }),
      });

      expect(result).toEqual({
        duplicate: false,
        dispatch: "installation_suspended",
      });

      const installation = await t.run(async (ctx) => {
        return await ctx.db.get(installationId);
      });

      expect(installation?.suspendedAt).toBeTypeOf("number");
    },
  );

  it("ignores disabled issue-opened events", async () => {
    const t = createTestConvex();
    const { userId, asUser } = await seedUser(t);
    const installationId = await seedInstallation(t, userId);
    const { repoId } = await seedRepo(t, { userId, installationId });
    await seedRepoSettings(asUser, repoId, {
      enabledEventTypes: ["issues.labeled"],
    });

    const result = await t.mutation(internal.webhooks.processWebhook, {
      deliveryId: "delivery_disabled_opened",
      event: "issues",
      action: "opened",
      payload: buildWebhookPayload(),
    });

    expect(result).toEqual({ duplicate: false, dispatch: "ignored" });

    const runs = await t.run(
      async (ctx) => await ctx.db.query("runs").collect(),
    );
    expect(runs).toHaveLength(0);
  });
});
