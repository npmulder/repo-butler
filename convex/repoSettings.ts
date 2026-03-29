import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import {
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireRepoAccess } from "./lib/auth";
import { normalizeAreaLabelValue } from "../lib/areaLabels";

export const DEFAULT_ENABLED_EVENT_TYPES = [
  "issues.opened",
  "issues.labeled",
  "issue_comment.created",
] as const;

export const DEFAULT_AUTO_APPROVE_THRESHOLD = 0.7;
export const DEFAULT_MAX_CONCURRENT_RUNS = 3;
export const DEFAULT_MAX_DAILY_RUNS = 20;
export type RepoSettingsEventType = (typeof DEFAULT_ENABLED_EVENT_TYPES)[number];

const approvalPolicyValidator = v.union(
  v.literal("auto_approve"),
  v.literal("require_label"),
  v.literal("require_comment"),
);

const enabledEventTypeValidator = v.union(
  v.literal("issues.opened"),
  v.literal("issues.labeled"),
  v.literal("issue_comment.created"),
);

type ApprovalPolicy = "auto_approve" | "require_label" | "require_comment";
type RepoSettingsDoc = Doc<"repoSettings"> | null;

export type RepoSettingsSnapshot = {
  repoId: Id<"repos">;
  approvalPolicy: ApprovalPolicy;
  autoApproveThreshold: number;
  maxConcurrentRuns: number;
  maxDailyRuns: number;
  customAreaLabels: string[];
  enabledEventTypes: string[];
  createdAt: number | null;
  updatedAt: number | null;
  isDefault: boolean;
};

function coerceCount(value: bigint | undefined, fallback: number) {
  if (value === undefined) {
    return fallback;
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.max(1, Math.floor(numericValue));
}

function normalizeAreaLabels(values: string[] | undefined) {
  const normalized = values
    ?.map((value) => normalizeAreaLabelValue(value))
    .filter((value): value is string => value !== null) ?? [];

  return [...new Set(normalized)];
}

function mapLegacyApprovalMode(
  approvalMode: Doc<"repoSettings">["approvalMode"] | undefined,
): ApprovalPolicy | null {
  if (approvalMode === "auto") {
    return "auto_approve";
  }

  if (approvalMode === "comment_required") {
    return "require_comment";
  }

  if (approvalMode === "label_required") {
    return "require_label";
  }

  return null;
}

function normalizeSettings(
  repoId: Id<"repos">,
  settings: RepoSettingsDoc,
): RepoSettingsSnapshot {
  const legacyAreaLabels =
    settings?.labelTaxonomy?.map((label) => label.replace(/^area:/i, "")) ?? [];
  const customAreaLabels = normalizeAreaLabels(
    settings?.customAreaLabels ?? legacyAreaLabels,
  );

  return {
    repoId,
    approvalPolicy:
      settings?.approvalPolicy ??
      mapLegacyApprovalMode(settings?.approvalMode) ??
      "require_label",
    autoApproveThreshold:
      settings?.autoApproveThreshold ?? DEFAULT_AUTO_APPROVE_THRESHOLD,
    maxConcurrentRuns: coerceCount(
      settings?.maxConcurrentRuns,
      DEFAULT_MAX_CONCURRENT_RUNS,
    ),
    maxDailyRuns: coerceCount(
      settings?.maxDailyRuns ?? settings?.dailyRunLimit,
      DEFAULT_MAX_DAILY_RUNS,
    ),
    customAreaLabels,
    enabledEventTypes:
      settings?.enabledEventTypes?.length
        ? [...new Set(settings.enabledEventTypes)]
        : [...DEFAULT_ENABLED_EVENT_TYPES],
    createdAt: settings?.createdAt ?? null,
    updatedAt: settings?.updatedAt ?? null,
    isDefault: settings === null,
  };
}

async function loadRepoSettings(
  ctx: MutationCtx | QueryCtx,
  repoId: Id<"repos">,
) {
  return await ctx.db
    .query("repoSettings")
    .withIndex("by_repo", (indexQuery) => indexQuery.eq("repoId", repoId))
    .unique();
}

export async function loadNormalizedRepoSettings(
  ctx: MutationCtx | QueryCtx,
  repoId: Id<"repos">,
) {
  return normalizeSettings(repoId, await loadRepoSettings(ctx, repoId));
}

export function isRepoEventTypeEnabled(
  settings: Pick<RepoSettingsSnapshot, "enabledEventTypes">,
  eventType: RepoSettingsEventType,
) {
  return settings.enabledEventTypes.includes(eventType);
}

function clampThreshold(value: number | undefined) {
  const numericValue = value ?? DEFAULT_AUTO_APPROVE_THRESHOLD;

  if (!Number.isFinite(numericValue)) {
    return DEFAULT_AUTO_APPROVE_THRESHOLD;
  }

  return Math.min(Math.max(numericValue, 0), 1);
}

function normalizeCountInput(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value ?? NaN)) {
    return fallback;
  }

  return Math.max(1, Math.floor(value ?? fallback));
}

function mapApprovalPolicyToLegacyMode(
  approvalPolicy: ApprovalPolicy,
): "auto" | "label_required" | "comment_required" {
  if (approvalPolicy === "auto_approve") {
    return "auto";
  }

  if (approvalPolicy === "require_comment") {
    return "comment_required";
  }

  return "label_required";
}

export const getInternalByRepo = internalQuery({
  args: { repoId: v.id("repos") },
  handler: async (ctx, args) => {
    return await loadNormalizedRepoSettings(ctx, args.repoId);
  },
});

export const getByRepo = query({
  args: { repoId: v.id("repos") },
  handler: async (ctx, args) => {
    await requireRepoAccess(ctx, args.repoId);
    return await loadNormalizedRepoSettings(ctx, args.repoId);
  },
});

export const upsert = mutation({
  args: {
    repoId: v.id("repos"),
    approvalPolicy: approvalPolicyValidator,
    autoApproveThreshold: v.optional(v.number()),
    maxConcurrentRuns: v.optional(v.number()),
    maxDailyRuns: v.optional(v.number()),
    customAreaLabels: v.optional(v.array(v.string())),
    enabledEventTypes: v.optional(v.array(enabledEventTypeValidator)),
  },
  handler: async (ctx, args) => {
    const { repo } = await requireRepoAccess(ctx, args.repoId);
    const existing = await loadRepoSettings(ctx, args.repoId);
    const now = Date.now();
    const normalizedCustomAreaLabels = normalizeAreaLabels(args.customAreaLabels);
    const maxConcurrentRuns = normalizeCountInput(
      args.maxConcurrentRuns,
      DEFAULT_MAX_CONCURRENT_RUNS,
    );
    const maxDailyRuns = normalizeCountInput(
      args.maxDailyRuns,
      DEFAULT_MAX_DAILY_RUNS,
    );
    const enabledEventTypes =
      args.enabledEventTypes && args.enabledEventTypes.length > 0
        ? [...new Set(args.enabledEventTypes)]
        : [...DEFAULT_ENABLED_EVENT_TYPES];
    const baseSettings = {
      repoId: repo._id,
      approvalPolicy: args.approvalPolicy,
      autoApproveThreshold: clampThreshold(args.autoApproveThreshold),
      maxConcurrentRuns: BigInt(maxConcurrentRuns),
      maxDailyRuns: BigInt(maxDailyRuns),
      customAreaLabels: normalizedCustomAreaLabels,
      enabledEventTypes,
      updatedAt: now,
      // Legacy fields are still written while the repoSettings schema remains widened.
      labelTaxonomy: normalizedCustomAreaLabels.map((label) => `area:${label}`),
      approvalMode: mapApprovalPolicyToLegacyMode(args.approvalPolicy),
      dailyRunLimit: BigInt(maxDailyRuns),
      sandboxTimeoutSeconds: existing?.sandboxTimeoutSeconds ?? BigInt(1200),
      networkEnabled: existing?.networkEnabled ?? false,
    };

    if (existing) {
      await ctx.db.patch(existing._id, baseSettings);
      return existing._id;
    }

    return await ctx.db.insert("repoSettings", {
      ...baseSettings,
      createdAt: now,
    });
  },
});
