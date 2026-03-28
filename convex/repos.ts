import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  requireCurrentUser,
  requireInstallationAccess,
  requireRepoAccess,
} from "./lib/auth";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);

    return await ctx.db
      .query("repos")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
  },
});

export const getByFullName = query({
  args: { fullName: v.string() },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const repo = await ctx.db
      .query("repos")
      .withIndex("by_full_name", (q) => q.eq("fullName", args.fullName))
      .unique();

    if (!repo || repo.userId !== user._id) {
      return null;
    }

    return repo;
  },
});

export const create = mutation({
  args: {
    installationId: v.id("githubInstallations"),
    owner: v.string(),
    name: v.string(),
    defaultBranch: v.string(),
    language: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireInstallationAccess(ctx, args.installationId);
    const now = Date.now();
    const repoId = await ctx.db.insert("repos", {
      ...args,
      userId: user._id,
      fullName: `${args.owner}/${args.name}`,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("repoSettings", {
      repoId,
      approvalMode: "label_required",
      maxConcurrentRuns: BigInt(3),
      dailyRunLimit: BigInt(20),
      sandboxTimeoutSeconds: BigInt(1200),
      networkEnabled: false,
    });

    return repoId;
  },
});

export const toggleActive = mutation({
  args: { repoId: v.id("repos"), isActive: v.boolean() },
  handler: async (ctx, args) => {
    await requireRepoAccess(ctx, args.repoId);

    await ctx.db.patch(args.repoId, {
      isActive: args.isActive,
      updatedAt: Date.now(),
    });
  },
});
