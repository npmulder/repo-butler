import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type AuthedCtx = MutationCtx | QueryCtx;

async function getAuthSubject(ctx: AuthedCtx) {
  const identity = await ctx.auth.getUserIdentity();

  if (!identity) {
    throw new Error("Not authenticated");
  }

  return identity.subject;
}

export async function requireCurrentUser(ctx: AuthedCtx): Promise<Doc<"users">> {
  const workosId = await getAuthSubject(ctx);

  const user = await ctx.db
    .query("users")
    .withIndex("by_workos_id", (q) => q.eq("workosId", workosId))
    .unique();

  if (!user) {
    throw new Error("Authenticated user has not been synced");
  }

  return user;
}

async function requireOwnedRepo(
  ctx: AuthedCtx,
  repoId: Id<"repos">,
  user: Doc<"users">,
  unauthorizedMessage: string,
) {
  const repo = await ctx.db.get(repoId);

  if (!repo) {
    throw new Error("Repo not found");
  }

  if (repo.userId !== user._id) {
    throw new Error(unauthorizedMessage);
  }

  return repo;
}

export async function requireRepoAccess(
  ctx: AuthedCtx,
  repoId: Id<"repos">,
): Promise<{ repo: Doc<"repos">; user: Doc<"users"> }> {
  const user = await requireCurrentUser(ctx);
  const repo = await requireOwnedRepo(ctx, repoId, user, "Not authorized for repo");

  return { repo, user };
}

export async function requireLoadedRunAccess(
  ctx: AuthedCtx,
  user: Doc<"users">,
  run: Doc<"runs">,
): Promise<{ run: Doc<"runs">; repo: Doc<"repos">; user: Doc<"users"> }> {
  const repo = await requireOwnedRepo(ctx, run.repoId, user, "Not authorized for run");

  return { run, repo, user };
}

export async function requireRunAccess(
  ctx: AuthedCtx,
  runId: Id<"runs">,
): Promise<{ run: Doc<"runs">; repo: Doc<"repos">; user: Doc<"users"> }> {
  const user = await requireCurrentUser(ctx);
  const run = await ctx.db.get(runId);

  if (!run) {
    throw new Error("Run not found");
  }

  return await requireLoadedRunAccess(ctx, user, run);
}

export async function requireInstallationAccess(
  ctx: MutationCtx,
  installationId: Id<"githubInstallations">,
): Promise<{ installation: Doc<"githubInstallations">; user: Doc<"users"> }> {
  const user = await requireCurrentUser(ctx);
  const installation = await ctx.db.get(installationId);

  if (!installation) {
    throw new Error("GitHub installation not found");
  }

  if (installation.userId !== user._id) {
    throw new Error("Not authorized for installation");
  }

  return { installation, user };
}
