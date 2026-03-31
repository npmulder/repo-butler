import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  approvalActionFromComment,
  approvalActionFromLabel,
  processApprovalCommentEvent,
  processApprovalLabelEvent,
} from "./approvalGate";
import {
  processWebhookDelivery,
  type RepoWebhookEventType,
  type WebhookStore,
} from "./lib/githubWebhooks";
import {
  AuditEventType,
  createAuditEvent,
  toAuditLogMutationArgs,
} from "../lib/security/audit-logger";
import {
  isRepoEventTypeEnabled,
  loadNormalizedRepoSettings,
} from "./repoSettings";

const webhookDispatchValidator = v.union(
  v.literal("issue_opened"),
  v.literal("repro_label"),
  v.literal("comment_command"),
  v.literal("status_command"),
  v.literal("installation_suspended"),
  v.literal("ignored"),
);
const approvalWebhookResultValidator = v.object({
  success: v.boolean(),
  error: v.optional(v.string()),
  ignored: v.optional(v.boolean()),
});

// GitHub.com only supports manual redelivery for recent deliveries and current
// GHES docs allow redelivery for up to 7 days, so keep idempotency records for
// 7 days to preserve normal duplicate-delivery protection across environments.
// https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries
// https://docs.github.com/en/enterprise-server@latest/webhooks/using-webhooks/automatically-redelivering-failed-deliveries-for-a-github-app-webhook
export const WEBHOOK_DELIVERY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const WEBHOOK_DELIVERY_CLEANUP_BATCH_SIZE = 128;

type WebhookDeliveryReaderCtx = {
  db: QueryCtx["db"];
};

function getWebhookDeliveryRetentionCutoff(now = Date.now()) {
  return now - WEBHOOK_DELIVERY_RETENTION_MS;
}

function isDeliveryWithinRetentionWindow(
  delivery: Pick<Doc<"webhookDeliveries">, "processedAt"> | null,
  now = Date.now(),
) {
  return (
    delivery !== null &&
    delivery.processedAt >= getWebhookDeliveryRetentionCutoff(now)
  );
}

async function getWebhookDeliveryRecord(
  ctx: WebhookDeliveryReaderCtx,
  deliveryId: string,
) {
  return await ctx.db
    .query("webhookDeliveries")
    .withIndex("by_delivery_id", (query) => query.eq("deliveryId", deliveryId))
    .unique();
}

function createWebhookStore(
  ctx: MutationCtx,
): WebhookStore<
  Id<"repos">,
  Id<"issues">,
  Id<"runs">,
  Id<"githubInstallations">,
  Id<"users">
> {
  return {
    hasDelivery: async (deliveryId) => {
      const delivery = await getWebhookDeliveryRecord(ctx, deliveryId);
      return isDeliveryWithinRetentionWindow(delivery);
    },
    recordDelivery: async ({ deliveryId, event, action, processedAt }) => {
      const existingDelivery = await getWebhookDeliveryRecord(ctx, deliveryId);

      if (existingDelivery) {
        await ctx.db.patch(existingDelivery._id, {
          event,
          action,
          processedAt,
        });
        return;
      }

      await ctx.db.insert("webhookDeliveries", {
        deliveryId,
        event,
        action,
        processedAt,
      });
    },
    getActiveRepoByFullName: async (fullName) => {
      const repo = await ctx.db
        .query("repos")
        .withIndex("by_full_name", (query) => query.eq("fullName", fullName))
        .unique();

      if (!repo || !repo.isActive) {
        return null;
      }

      return {
        id: repo._id,
        userId: repo.userId,
        fullName: repo.fullName,
      };
    },
    isEventTypeEnabled: async (repoId, eventType: RepoWebhookEventType) => {
      const settings = await loadNormalizedRepoSettings(ctx, repoId);
      return isRepoEventTypeEnabled(settings, eventType);
    },
    createIssueSnapshot: async (input) => {
      const now = Date.now();
      const issueId = await ctx.db.insert("issues", {
        repoId: input.repoId,
        githubIssueNumber: input.githubIssueNumber,
        githubIssueUrl: input.githubIssueUrl,
        title: input.title,
        ...(input.body !== undefined ? { body: input.body } : {}),
        authorLogin: input.authorLogin,
        ...(input.githubCreatedAt !== undefined
          ? { githubCreatedAt: input.githubCreatedAt }
          : {}),
        labels: input.labels,
        state: input.state,
        snapshotedAt: now,
        createdAt: now,
      });

      return {
        id: issueId,
        repoId: input.repoId,
        githubIssueNumber: input.githubIssueNumber,
      };
    },
    createRun: async ({
      issueId,
      repo,
      githubIssueNumber,
      triggeredBy,
      startedAt,
    }) => {
      const runId = `${new Date(startedAt).toISOString()}_${repo.fullName}_${githubIssueNumber.toString()}`;

      return await ctx.db.insert("runs", {
        runId,
        userId: repo.userId,
        issueId,
        repoId: repo.id,
        triggeredBy,
        status: "pending",
        startedAt,
      });
    },
    scheduleTriage: async (runId, issueId) => {
      await ctx.scheduler.runAfter(0, internal.pipeline.runTriage, {
        runId,
        issueId,
      });
    },
    getInstallationByInstallationId: async (installationId) => {
      const installation = await ctx.db
        .query("githubInstallations")
        .withIndex("by_installation_id", (query) =>
          query.eq("installationId", installationId),
        )
        .unique();

      return installation
        ? { id: installation._id, installationId: installation.installationId }
        : null;
    },
    markInstallationSuspended: async (installationId, suspendedAt) => {
      await ctx.db.patch(installationId, { suspendedAt });
    },
  };
}

export const getDelivery = internalQuery({
  args: { deliveryId: v.string() },
  handler: async (ctx, args) => {
    return await getWebhookDeliveryRecord(ctx, args.deliveryId);
  },
});

export const cleanupExpiredDeliveries = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
    cutoffTime: v.optional(v.number()),
    scheduleContinuation: v.optional(v.boolean()),
  },
  returns: v.object({
    cutoffTime: v.number(),
    deletedCount: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const cutoffTime = args.cutoffTime ?? getWebhookDeliveryRetentionCutoff();
    const batchSize = Math.max(
      1,
      Math.floor(args.batchSize ?? WEBHOOK_DELIVERY_CLEANUP_BATCH_SIZE),
    );
    const queryLimit = batchSize + 1;
    const expiredDeliveries = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_processed_at", (query) =>
        query.lt("processedAt", cutoffTime),
      )
      .take(queryLimit);
    const deliveriesToDelete = expiredDeliveries.slice(0, batchSize);

    for (const delivery of deliveriesToDelete) {
      await ctx.db.delete(delivery._id);
    }

    const hasMore = expiredDeliveries.length > batchSize;

    if (hasMore && args.scheduleContinuation !== false) {
      await ctx.scheduler.runAfter(
        0,
        internal.webhooks.cleanupExpiredDeliveries,
        {
          batchSize,
          cutoffTime,
          scheduleContinuation: true,
        },
      );
    }

    return {
      cutoffTime,
      deletedCount: deliveriesToDelete.length,
      hasMore,
    };
  },
});

export const processWebhook = internalMutation({
  args: {
    deliveryId: v.string(),
    event: v.string(),
    action: v.string(),
    payload: v.any(),
  },
  returns: v.object({
    duplicate: v.boolean(),
    dispatch: webhookDispatchValidator,
  }),
  handler: async (ctx, args) => {
    const result = await processWebhookDelivery(createWebhookStore(ctx), {
      deliveryId: args.deliveryId,
      event: args.event,
      action: args.action,
      payload: args.payload,
    });

    await ctx.runMutation(
      internal.auditLogs.log,
      toAuditLogMutationArgs(
        createAuditEvent(
          AuditEventType.WEBHOOK_RECEIVED,
          "github",
          { type: "webhook", id: args.deliveryId },
          {
            event: args.event,
            action: args.action,
            dispatch: result.dispatch,
            duplicate: result.duplicate,
          },
        ),
      ),
    );

    return result;
  },
});

export const handleLabelAdded = internalMutation({
  args: {
    repoFullName: v.string(),
    issueNumber: v.int64(),
    labelName: v.string(),
    actor: v.string(),
  },
  returns: approvalWebhookResultValidator,
  handler: async (ctx, args) => {
    if (!approvalActionFromLabel(args.labelName)) {
      return { success: false, ignored: true };
    }

    const repo = await ctx.db
      .query("repos")
      .withIndex("by_full_name", (indexQuery) =>
        indexQuery.eq("fullName", args.repoFullName),
      )
      .unique();

    if (!repo) {
      return { success: false, error: "Repo not found" };
    }

    const settings = await loadNormalizedRepoSettings(ctx, repo._id);

    if (!isRepoEventTypeEnabled(settings, "issues.labeled")) {
      return { success: false, ignored: true };
    }

    return await processApprovalLabelEvent(ctx, {
      repoId: repo._id,
      issueNumber: args.issueNumber,
      labelName: args.labelName,
      actor: args.actor,
    });
  },
});

export const handleCommentAdded = internalMutation({
  args: {
    repoFullName: v.string(),
    issueNumber: v.int64(),
    commentBody: v.string(),
    actor: v.string(),
    authorAssociation: v.optional(v.string()),
  },
  returns: approvalWebhookResultValidator,
  handler: async (ctx, args) => {
    if (!approvalActionFromComment(args.commentBody)) {
      return { success: false, ignored: true };
    }

    const repo = await ctx.db
      .query("repos")
      .withIndex("by_full_name", (indexQuery) =>
        indexQuery.eq("fullName", args.repoFullName),
      )
      .unique();

    if (!repo) {
      return { success: false, error: "Repo not found" };
    }

    const settings = await loadNormalizedRepoSettings(ctx, repo._id);

    if (!isRepoEventTypeEnabled(settings, "issue_comment.created")) {
      return { success: false, ignored: true };
    }

    return await processApprovalCommentEvent(ctx, {
      repoId: repo._id,
      issueNumber: args.issueNumber,
      commentBody: args.commentBody,
      actor: args.actor,
      authorAssociation: args.authorAssociation,
    });
  },
});
