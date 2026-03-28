import { AuthKit, type AuthFunctions } from "@convex-dev/workos-authkit";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";

const hasWorkosWebhookConfig = Boolean(
  process.env.WORKOS_CLIENT_ID &&
    process.env.WORKOS_API_KEY &&
    process.env.WORKOS_WEBHOOK_SECRET,
);

const authFunctions: AuthFunctions = internal.auth;

export const authKit = hasWorkosWebhookConfig
  ? new AuthKit<DataModel>(components.workOSAuthKit, { authFunctions })
  : null;

function getName(data: Record<string, unknown>) {
  const firstName =
    typeof data.firstName === "string" ? data.firstName.trim() : "";
  const lastName =
    typeof data.lastName === "string" ? data.lastName.trim() : "";
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

  return fullName.length > 0 ? fullName : undefined;
}

export const authKitEvent = internalMutation({
  args: {
    event: v.string(),
    data: v.record(v.string(), v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const workosId = typeof args.data.id === "string" ? args.data.id : null;

    if (!workosId) {
      return null;
    }

    const existing = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", workosId))
      .unique();

    if (args.event === "user.deleted") {
      if (existing) {
        await ctx.db.delete(existing._id);
      }

      return null;
    }

    const email = typeof args.data.email === "string" ? args.data.email : null;

    if (!email) {
      return null;
    }

    const patch = {
      email,
      name: getName(args.data),
      avatarUrl:
        typeof args.data.profilePictureUrl === "string"
          ? args.data.profilePictureUrl
          : undefined,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return null;
    }

    await ctx.db.insert("users", {
      workosId,
      createdAt: patch.updatedAt,
      ...patch,
    });

    return null;
  },
});
