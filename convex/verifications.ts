import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, query, type QueryCtx } from "./_generated/server";
import { requireRepoAccess, requireRunAccess } from "./lib/auth";

function normalizeLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 20, 1), 100);
}

function compareByCreatedAtDesc(
  left: Doc<"verifications">,
  right: Doc<"verifications">,
) {
  return right.createdAt - left.createdAt;
}

async function listLegacyVerifiedByRepo(
  ctx: QueryCtx,
  repoId: Id<"repos">,
  limit: number,
  seenVerificationIds: Set<Id<"verifications">>,
) {
  const verifications: Array<Doc<"verifications">> = [];

  if (limit <= 0) {
    return verifications;
  }

  for await (const run of ctx.db
    .query("runs")
    .withIndex("by_repo", (query) => query.eq("repoId", repoId))
    .order("desc")) {
    if (verifications.length >= limit) {
      break;
    }

    if (run.verdict !== "reproduced") {
      continue;
    }

    const verification = await ctx.db
      .query("verifications")
      .withIndex("by_run", (query) => query.eq("runId", run._id))
      .unique();

    if (
      !verification ||
      verification.verdict !== "reproduced" ||
      verification.repoId !== undefined ||
      seenVerificationIds.has(verification._id)
    ) {
      continue;
    }

    seenVerificationIds.add(verification._id);
    verifications.push(verification);
  }

  return verifications;
}

export const getByRunId = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    await requireRunAccess(ctx, args.runId);

    return await ctx.db
      .query("verifications")
      .withIndex("by_run", (query) => query.eq("runId", args.runId))
      .unique();
  },
});

export const getInternalByRunId = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("verifications")
      .withIndex("by_run", (query) => query.eq("runId", args.runId))
      .unique();
  },
});

export const listVerified = query({
  args: {
    repoId: v.id("repos"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireRepoAccess(ctx, args.repoId);

    const limit = normalizeLimit(args.limit);
    const indexedVerifications = await ctx.db
      .query("verifications")
      .withIndex("by_repo_and_verdict_and_created_at", (query) =>
        query.eq("repoId", args.repoId).eq("verdict", "reproduced"),
      )
      .order("desc")
      .take(limit);

    if (indexedVerifications.length >= limit) {
      return indexedVerifications;
    }

    const seenVerificationIds = new Set<Id<"verifications">>(
      indexedVerifications.map((verification) => verification._id),
    );
    const legacyVerifications = await listLegacyVerifiedByRepo(
      ctx,
      args.repoId,
      limit - indexedVerifications.length,
      seenVerificationIds,
    );

    return [...indexedVerifications, ...legacyVerifications]
      .sort(compareByCreatedAtDesc)
      .slice(0, limit);
  },
});
