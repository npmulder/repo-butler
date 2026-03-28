import { AuthKit, type AuthFunctions } from "@convex-dev/workos-authkit";

import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";

const authFunctions: AuthFunctions = internal.auth;

export const authKit = new AuthKit<DataModel>(components.workOSAuthKit, {
  authFunctions,
});

export const { authKitEvent } = authKit.events({
  "user.created": async (ctx, event) => {
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", event.data.id))
      .unique();

    const profile = {
      email: event.data.email,
      name: [event.data.firstName, event.data.lastName].filter(Boolean).join(" ") || undefined,
      avatarUrl: event.data.profilePictureUrl ?? undefined,
    };

    if (existingUser) {
      await ctx.db.patch(existingUser._id, profile);
      return;
    }

    await ctx.db.insert("users", {
      workosId: event.data.id,
      ...profile,
      createdAt: Date.now(),
    });
  },
  "user.updated": async (ctx, event) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", event.data.id))
      .unique();

    if (!user) {
      return;
    }

    await ctx.db.patch(user._id, {
      email: event.data.email,
      name: [event.data.firstName, event.data.lastName].filter(Boolean).join(" ") || undefined,
      avatarUrl: event.data.profilePictureUrl ?? undefined,
    });
  },
  "user.deleted": async (ctx, event) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", event.data.id))
      .unique();

    if (!user) {
      return;
    }

    await ctx.db.delete(user._id);
  },
});
