import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { requireCurrentUser } from "./lib/auth";

const permissionsValidator = v.record(v.string(), v.string());
const accountTypeValidator = v.union(
  v.literal("Organization"),
  v.literal("User"),
);

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);

    return await ctx.db
      .query("githubInstallations")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(50);
  },
});

export const getByInstallationId = query({
  args: { installationId: v.int64() },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const installation = await ctx.db
      .query("githubInstallations")
      .withIndex("by_installation_id", (q) =>
        q.eq("installationId", args.installationId),
      )
      .unique();

    if (!installation || installation.userId !== user._id) {
      return null;
    }

    return installation;
  },
});

export const upsert = mutation({
  args: {
    installationId: v.int64(),
    accountLogin: v.string(),
    accountType: accountTypeValidator,
    permissions: permissionsValidator,
    suspendedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const existing = await ctx.db
      .query("githubInstallations")
      .withIndex("by_installation_id", (q) =>
        q.eq("installationId", args.installationId),
      )
      .unique();

    const installationDoc = {
      userId: user._id,
      installationId: args.installationId,
      accountLogin: args.accountLogin,
      accountType: args.accountType,
      permissions: args.permissions,
      ...(args.suspendedAt !== undefined
        ? { suspendedAt: args.suspendedAt }
        : {}),
    };

    if (existing) {
      if (existing.userId !== user._id) {
        throw new Error("GitHub installation already belongs to another user");
      }

      await ctx.db.replace(existing._id, {
        ...installationDoc,
        createdAt: existing.createdAt,
      });

      return existing._id;
    }

    return await ctx.db.insert("githubInstallations", {
      ...installationDoc,
      createdAt: Date.now(),
    });
  },
});
