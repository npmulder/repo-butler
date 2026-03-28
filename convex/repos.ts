import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

import { internalQuery, mutation, query } from "./_generated/server";
import {
  requireCurrentUser,
  requireInstallationAccess,
  requireRepoAccess,
} from "./lib/auth";

const githubRepoValidator = v.object({
  owner: v.string(),
  name: v.string(),
  defaultBranch: v.string(),
  language: v.optional(v.string()),
});

async function insertDefaultRepoSettings(
  ctx: MutationCtx,
  repoId: Id<"repos">,
) {
  await ctx.db.insert("repoSettings", {
    repoId,
    approvalMode: "label_required",
    maxConcurrentRuns: BigInt(3),
    dailyRunLimit: BigInt(20),
    sandboxTimeoutSeconds: BigInt(1200),
    networkEnabled: false,
  });
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);

    return await ctx.db
      .query("repos")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(100);
  },
});

export const getByFullName = query({
  args: { fullName: v.string() },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const repo = await ctx.db
      .query("repos")
      .withIndex("by_user_and_full_name", (q) =>
        q.eq("userId", user._id).eq("fullName", args.fullName),
      )
      .unique();

    return repo ?? null;
  },
});

export const getById = internalQuery({
  args: { repoId: v.id("repos") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.repoId);
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
      userId: user._id,
      installationId: args.installationId,
      owner: args.owner,
      name: args.name,
      fullName: `${args.owner}/${args.name}`,
      defaultBranch: args.defaultBranch,
      ...(args.language !== undefined ? { language: args.language } : {}),
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await insertDefaultRepoSettings(ctx, repoId);

    return repoId;
  },
});

export const syncFromGitHub = mutation({
  args: {
    installationId: v.id("githubInstallations"),
    repos: v.array(githubRepoValidator),
  },
  handler: async (ctx, args) => {
    const { installation, user } = await requireInstallationAccess(
      ctx,
      args.installationId,
    );
    const existingRepos = new Map<string, Doc<"repos">>();
    const now = Date.now();
    let createdCount = 0;
    let updatedCount = 0;

    for await (const repo of ctx.db
      .query("repos")
      .withIndex("by_user", (q) => q.eq("userId", user._id))) {
      existingRepos.set(repo.fullName, repo);
    }

    for (const repo of args.repos) {
      const fullName = `${repo.owner}/${repo.name}`;
      const existing = existingRepos.get(fullName);
      const nextRepo = {
        userId: user._id,
        installationId: installation._id,
        owner: repo.owner,
        name: repo.name,
        fullName,
        defaultBranch: repo.defaultBranch,
        ...(repo.language !== undefined ? { language: repo.language } : {}),
        isActive: existing?.isActive ?? true,
        updatedAt: now,
      };

      if (existing) {
        await ctx.db.replace(existing._id, {
          ...nextRepo,
          createdAt: existing.createdAt,
        });
        updatedCount += 1;
        continue;
      }

      const repoId = await ctx.db.insert("repos", {
        ...nextRepo,
        createdAt: now,
      });
      await insertDefaultRepoSettings(ctx, repoId);
      createdCount += 1;
    }

    return {
      createdCount,
      updatedCount,
      totalCount: args.repos.length,
    };
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
