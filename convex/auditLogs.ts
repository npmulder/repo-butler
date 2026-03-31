import { v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server";
import {
  RATE_LIMITS,
  checkRateLimit,
  type RateLimitStore,
} from "../lib/security/rate-limiter";
import { redactSensitiveFields } from "../lib/security/audit-logger";

const severityValidator = v.union(
  v.literal("info"),
  v.literal("warning"),
  v.literal("critical"),
);
const rateLimitNameValidator = v.union(
  v.literal("webhookIngestion"),
  v.literal("triagePerRepo"),
  v.literal("reproPerRepo"),
  v.literal("claudeApiCalls"),
  v.literal("githubApiCalls"),
);

export const log = internalMutation({
  args: {
    type: v.string(),
    timestamp: v.number(),
    actor: v.string(),
    resourceType: v.string(),
    resourceId: v.string(),
    details: v.any(),
    severity: severityValidator,
    ip: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const details = Array.isArray(args.details)
      ? args.details.map((item) =>
          typeof item === "object" && item !== null && !Array.isArray(item)
            ? redactSensitiveFields(item as Record<string, unknown>)
            : item,
        )
      : typeof args.details === "object" &&
          args.details !== null &&
          !Array.isArray(args.details)
        ? redactSensitiveFields(args.details as Record<string, unknown>)
        : args.details;

    return await ctx.db.insert("auditLogs", {
      ...args,
      details,
    });
  },
});

export const listRecent = internalQuery({
  args: {
    severity: v.optional(severityValidator),
    since: v.optional(v.number()),
    limit: v.optional(v.number()),
    resourceType: v.optional(v.string()),
    resourceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const since = args.since ?? 0;
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 200);
    const resourceType = args.resourceType;
    const resourceId = args.resourceId;
    const severity = args.severity;

    if (resourceType && resourceId) {
      return await ctx.db
        .query("auditLogs")
        .withIndex("by_resource_type_and_resource_id_and_timestamp", (query) =>
          query
            .eq("resourceType", resourceType)
            .eq("resourceId", resourceId)
            .gte("timestamp", since),
        )
        .order("desc")
        .take(limit);
    }

    if (severity) {
      return await ctx.db
        .query("auditLogs")
        .withIndex("by_severity_and_timestamp", (query) =>
          query.eq("severity", severity).gte("timestamp", since),
        )
        .order("desc")
        .take(limit);
    }

    return await ctx.db
      .query("auditLogs")
      .withIndex("by_timestamp", (query) => query.gte("timestamp", since))
      .order("desc")
      .take(limit);
  },
});

export const enforceRateLimit = internalMutation({
  args: {
    name: rateLimitNameValidator,
    key: v.string(),
  },
  returns: v.object({
    allowed: v.boolean(),
    remaining: v.number(),
    resetAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const store: RateLimitStore = {
      listEventsSince: async (key, since, limit) => {
        return await ctx.db
          .query("rateLimitEvents")
          .withIndex("by_key_and_timestamp", (query) =>
            query.eq("key", key).gte("timestamp", since),
          )
          .order("asc")
          .take(limit);
      },
      insertEvent: async (event) => {
        await ctx.db.insert("rateLimitEvents", event);
      },
    };

    return await checkRateLimit(store, args.key, RATE_LIMITS[args.name]);
  },
});
