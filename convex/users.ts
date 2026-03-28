import { v } from "convex/values";

import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";

async function upsertUser(
  ctx: MutationCtx,
  args: {
    workosId: string;
    email: string;
    name?: string;
    avatarUrl?: string;
  },
) {
  const existing = await ctx.db
    .query("users")
    .withIndex("by_workos_id", (q) => q.eq("workosId", args.workosId))
    .unique();
  const now = Date.now();
  const userDoc = {
    workosId: args.workosId,
    email: args.email,
    ...(args.name !== undefined ? { name: args.name } : {}),
    ...(args.avatarUrl !== undefined ? { avatarUrl: args.avatarUrl } : {}),
    updatedAt: now,
  };

  if (existing) {
    await ctx.db.replace(existing._id, {
      ...userDoc,
      createdAt: existing.createdAt,
    });

    return existing._id;
  }

  return await ctx.db.insert("users", {
    ...userDoc,
    createdAt: now,
  });
}

export const upsertFromWorkOS = internalMutation({
  args: {
    workosId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await upsertUser(ctx, args);
  },
});

export const getByWorkOSId = internalQuery({
  args: { workosId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", args.workosId))
      .unique();
  },
});

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      return null;
    }

    return await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", identity.subject))
      .unique();
  },
});

export const ensureCurrentUser = mutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      throw new Error("Not authenticated");
    }

    return await upsertUser(ctx, {
      workosId: identity.subject,
      ...args,
    });
  },
});
