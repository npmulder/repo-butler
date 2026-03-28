import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { STATUS_LABELS } from "../lib/labels";
import {
  loadNormalizedRepoSettings,
  type RepoSettingsSnapshot,
} from "./repoSettings";

export const approvalPolicies = {
  autoApprove: "auto_approve",
  requireLabel: "require_label",
  requireComment: "require_comment",
} as const;

export type ApprovalPolicy =
  (typeof approvalPolicies)[keyof typeof approvalPolicies];
export type ApprovalAction = "approve" | "reject" | "request_info";

export type ApprovalDecision = {
  approved: boolean;
  reason: string;
};

export type ApprovalGateSettings = {
  approvalPolicy: ApprovalPolicy;
  autoApproveThreshold: number;
  maxConcurrentRuns: number;
  maxDailyRuns: number;
  isDefault?: boolean;
};

type ApprovalPatchResult =
  | {
      success: true;
      patch: Partial<Doc<"runs">>;
    }
  | {
      success: false;
      error: string;
    };

const activeRunStatuses = new Set<Doc<"runs">["status"]>([
  "reproducing",
  "verifying",
]);
const approvalDecisionValidator = v.object({
  approved: v.boolean(),
  reason: v.string(),
});
const approvalMutationResultValidator = v.object({
  success: v.boolean(),
  error: v.optional(v.string()),
});

function formatAwaitingApprovalReason(settings: ApprovalGateSettings | null) {
  if (!settings || settings.isDefault) {
    return "No repo settings configured; defaulting to maintainer label approval";
  }

  return settings.approvalPolicy === approvalPolicies.requireComment
    ? "Awaiting maintainer approval comment"
    : "Awaiting maintainer approval label";
}

export function evaluateApprovalGate({
  settings,
  triageConfidence,
  reproEligible,
  activeRuns,
  dailyRuns,
}: {
  settings: ApprovalGateSettings | null;
  triageConfidence: number;
  reproEligible: boolean;
  activeRuns: number;
  dailyRuns: number;
}): ApprovalDecision {
  if (!reproEligible) {
    return { approved: false, reason: "Issue not eligible for reproduction" };
  }

  const resolvedSettings = settings ?? {
    approvalPolicy: approvalPolicies.requireLabel,
    autoApproveThreshold: 0.7,
    maxConcurrentRuns: 3,
    maxDailyRuns: 20,
    isDefault: true,
  };

  if (activeRuns >= resolvedSettings.maxConcurrentRuns) {
    return {
      approved: false,
      reason: `Max concurrent runs reached (${resolvedSettings.maxConcurrentRuns})`,
    };
  }

  if (dailyRuns >= resolvedSettings.maxDailyRuns) {
    return {
      approved: false,
      reason: `Daily run limit reached (${resolvedSettings.maxDailyRuns})`,
    };
  }

  if (resolvedSettings.approvalPolicy === approvalPolicies.autoApprove) {
    if (triageConfidence >= resolvedSettings.autoApproveThreshold) {
      return {
        approved: true,
        reason: "Auto-approved (high confidence)",
      };
    }

    return {
      approved: false,
      reason: `Confidence below auto-approve threshold (${resolvedSettings.autoApproveThreshold.toFixed(2)})`,
    };
  }

  return {
    approved: false,
    reason: formatAwaitingApprovalReason(resolvedSettings),
  };
}

export function approvalActionFromLabel(labelName: string): ApprovalAction | null {
  return labelName === STATUS_LABELS.reproApproved ? "approve" : null;
}

export function approvalActionFromComment(
  commentBody: string,
): ApprovalAction | null {
  const match = commentBody.match(
    /\B@repobutler\s+(approve|reject|request(?:[-_\s]?info))\b/i,
  );

  if (!match) {
    return null;
  }

  const normalizedCommand = match[1].toLowerCase().replace(/[-_\s]/g, "");

  if (normalizedCommand === "approve") {
    return "approve";
  }

  if (normalizedCommand === "reject") {
    return "reject";
  }

  return "request_info";
}

export function buildApprovalPatch({
  action,
  approvedAt,
  approvedBy,
  runStatus,
}: {
  action: ApprovalAction;
  approvedAt: number;
  approvedBy: string;
  runStatus: Doc<"runs">["status"];
}): ApprovalPatchResult {
  if (runStatus !== "awaiting_approval") {
    return {
      success: false,
      error: "Run not in awaiting_approval state",
    };
  }

  if (action === "approve") {
    return {
      success: true,
      patch: {
        status: "approved",
        approvedAt,
        approvedBy,
        errorMessage: `Approved by ${approvedBy}`,
      },
    };
  }

  if (action === "reject") {
    return {
      success: true,
      patch: {
        status: "rejected",
        approvedAt,
        approvedBy,
        completedAt: approvedAt,
        errorMessage: `Reproduction rejected by ${approvedBy}`,
      },
    };
  }

  return {
    success: true,
    patch: {
      status: "needs_info",
      approvedAt,
      approvedBy,
      completedAt: approvedAt,
      errorMessage: `Maintainer requested more information (${approvedBy})`,
    },
  };
}

async function countRecentRuns(
  ctx: QueryCtx,
  repoId: Id<"repos">,
  maxDailyRuns: number,
) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let dailyRuns = 0;
  let activeRuns = 0;

  for await (const run of ctx.db
    .query("runs")
    .withIndex("by_repo", (indexQuery) =>
      indexQuery.eq("repoId", repoId).gte("startedAt", cutoff),
    )
    .order("desc")) {
    dailyRuns += 1;

    if (activeRunStatuses.has(run.status)) {
      activeRuns += 1;
    }

    if (dailyRuns >= maxDailyRuns) {
      break;
    }
  }

  return { activeRuns, dailyRuns };
}

async function loadLatestRunForIssue(
  ctx: MutationCtx,
  repoId: Id<"repos">,
  issueNumber: bigint,
) {
  const issue = await ctx.db
    .query("issues")
    .withIndex(
      "by_repo_and_github_issue_number_and_snapshoted_at",
      (indexQuery) =>
        indexQuery.eq("repoId", repoId).eq("githubIssueNumber", issueNumber),
    )
    .order("desc")
    .first();

  if (!issue) {
    return null;
  }

  return await ctx.db
    .query("runs")
    .withIndex("by_issue", (indexQuery) => indexQuery.eq("issueId", issue._id))
    .order("desc")
    .first();
}

async function applyApproval(
  ctx: MutationCtx,
  {
    action,
    approvedBy,
    runId,
  }: {
    action: ApprovalAction;
    approvedBy: string;
    runId: Id<"runs">;
  },
) {
  const run = await ctx.db.get(runId);

  if (!run) {
    return { success: false, error: "Run not found" as const };
  }

  const outcome = buildApprovalPatch({
    action,
    approvedAt: Date.now(),
    approvedBy,
    runStatus: run.status,
  });

  if (!outcome.success) {
    return outcome;
  }

  await ctx.db.patch(runId, outcome.patch);

  return { success: true as const };
}

export async function processApprovalLabelEvent(
  ctx: MutationCtx,
  args: {
    repoId: Id<"repos">;
    issueNumber: bigint;
    labelName: string;
    actor: string;
  },
) {
  const action = approvalActionFromLabel(args.labelName);

  if (!action) {
    return { success: false, error: "Unrecognized approval label" };
  }

  const run = await loadLatestRunForIssue(ctx, args.repoId, args.issueNumber);

  if (!run) {
    return { success: false, error: "No run awaiting approval" };
  }

  return await applyApproval(ctx, {
    runId: run._id,
    action,
    approvedBy: args.actor,
  });
}

export async function processApprovalCommentEvent(
  ctx: MutationCtx,
  args: {
    repoId: Id<"repos">;
    issueNumber: bigint;
    commentBody: string;
    actor: string;
  },
) {
  const action = approvalActionFromComment(args.commentBody);

  if (!action) {
    return { success: false, error: "Unrecognized approval comment" };
  }

  const run = await loadLatestRunForIssue(ctx, args.repoId, args.issueNumber);

  if (!run) {
    return { success: false, error: "No run awaiting approval" };
  }

  return await applyApproval(ctx, {
    runId: run._id,
    action,
    approvedBy: args.actor,
  });
}

export const checkApproval = internalQuery({
  args: {
    repoId: v.id("repos"),
    runId: v.id("runs"),
    triageConfidence: v.number(),
    reproEligible: v.boolean(),
  },
  returns: approvalDecisionValidator,
  handler: async (ctx, args): Promise<ApprovalDecision> => {
    const run = await ctx.db.get(args.runId);

    if (!run || run.repoId !== args.repoId) {
      throw new Error("Run not found for repository");
    }

    const settings: RepoSettingsSnapshot = await loadNormalizedRepoSettings(
      ctx,
      args.repoId,
    );
    const { activeRuns, dailyRuns } = await countRecentRuns(
      ctx,
      args.repoId,
      settings.maxDailyRuns,
    );

    return evaluateApprovalGate({
      settings,
      triageConfidence: args.triageConfidence,
      reproEligible: args.reproEligible,
      activeRuns,
      dailyRuns,
    });
  },
});

export const processApproval = internalMutation({
  args: {
    runId: v.id("runs"),
    action: v.union(
      v.literal("approve"),
      v.literal("reject"),
      v.literal("request_info"),
    ),
    approvedBy: v.string(),
  },
  returns: approvalMutationResultValidator,
  handler: async (ctx, args) => {
    return await applyApproval(ctx, args);
  },
});

export const handleApprovalLabel = internalMutation({
  args: {
    repoId: v.id("repos"),
    issueNumber: v.int64(),
    labelName: v.string(),
    actor: v.string(),
  },
  returns: approvalMutationResultValidator,
  handler: async (ctx, args) => {
    return await processApprovalLabelEvent(ctx, args);
  },
});

export const handleApprovalComment = internalMutation({
  args: {
    repoId: v.id("repos"),
    issueNumber: v.int64(),
    commentBody: v.string(),
    actor: v.string(),
  },
  returns: approvalMutationResultValidator,
  handler: async (ctx, args) => {
    return await processApprovalCommentEvent(ctx, args);
  },
});
