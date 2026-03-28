import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import {
  approvalActionFromComment,
  approvalActionFromLabel,
  processApprovalCommentEvent,
  processApprovalLabelEvent,
} from "./approvalGate";
import {
  processWebhookDelivery,
  type WebhookStore,
} from "./lib/githubWebhooks";

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
      const delivery = await ctx.db
        .query("webhookDeliveries")
        .withIndex("by_delivery_id", (query) =>
          query.eq("deliveryId", deliveryId),
        )
        .unique();

      return delivery !== null;
    },
    recordDelivery: async ({ deliveryId, event, action, processedAt }) => {
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
    createRun: async ({ issueId, repo, githubIssueNumber, triggeredBy, startedAt }) => {
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
    return await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_delivery_id", (query) =>
        query.eq("deliveryId", args.deliveryId),
      )
      .unique();
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
    return await processWebhookDelivery(createWebhookStore(ctx), {
      deliveryId: args.deliveryId,
      event: args.event,
      action: args.action,
      payload: args.payload,
    });
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

    return await processApprovalCommentEvent(ctx, {
      repoId: repo._id,
      issueNumber: args.issueNumber,
      commentBody: args.commentBody,
      actor: args.actor,
    });
  },
});
