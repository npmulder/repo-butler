import { convexTest } from "convex-test";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { modules } from "./modules";
import schema from "../../convex/schema";

export function createTestConvex() {
  return convexTest(schema, modules);
}

export type RepoButlerTest = ReturnType<typeof createTestConvex>;
export type RepoButlerAuthedTest = ReturnType<RepoButlerTest["withIdentity"]>;

type SeedUserOptions = {
  workosId?: string;
  email?: string;
  name?: string;
};

type SeedRepoOptions = {
  owner?: string;
  name?: string;
  defaultBranch?: string;
  language?: string;
  isActive?: boolean;
};

type SeedIssueOptions = {
  githubIssueNumber?: bigint;
  githubIssueUrl?: string;
  title?: string;
  body?: string;
  labels?: string[];
  state?: "open" | "closed";
  githubCreatedAt?: string;
};

type SeedRunOptions = {
  runId?: string;
  status?: Doc<"runs">["status"];
  triggeredBy?: Doc<"runs">["triggeredBy"];
  startedAt?: number;
  verdict?: Doc<"runs">["verdict"];
  errorMessage?: string;
};

export async function seedUser(
  t: RepoButlerTest,
  options: SeedUserOptions = {},
) {
  const now = Date.now();
  const workosId =
    options.workosId ?? `workos|${Math.random().toString(36).slice(2, 10)}`;
  const email =
    options.email ?? `${workosId.replace(/[^a-z0-9]/gi, "-")}@example.com`;
  const name = options.name ?? "Repo Butler Tester";
  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      workosId,
      email,
      name,
      createdAt: now,
      updatedAt: now,
    });
  });

  return {
    userId,
    workosId,
    asUser: t.withIdentity({
      issuer: "https://auth.example.test",
      subject: workosId,
      tokenIdentifier: workosId,
      name,
      email,
    }),
  };
}

export async function seedInstallation(
  t: RepoButlerTest,
  userId: Id<"users">,
  installationId = BigInt(1001),
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("githubInstallations", {
      userId,
      installationId,
      accountLogin: "repo-butler",
      accountType: "Organization",
      permissions: { issues: "write" },
      createdAt: Date.now(),
    });
  });
}

export async function seedRepo(
  t: RepoButlerTest,
  {
    userId,
    installationId,
    owner = "repo-butler",
    name = "example",
    defaultBranch = "main",
    language = "TypeScript",
    isActive = true,
  }: SeedRepoOptions & {
    userId: Id<"users">;
    installationId: Id<"githubInstallations">;
  },
) {
  const now = Date.now();
  const repoId = await t.run(async (ctx) => {
    return await ctx.db.insert("repos", {
      userId,
      installationId,
      owner,
      name,
      fullName: `${owner}/${name}`,
      defaultBranch,
      language,
      isActive,
      createdAt: now,
      updatedAt: now,
    });
  });

  return {
    repoId,
    fullName: `${owner}/${name}`,
  };
}

export async function seedIssue(
  t: RepoButlerTest,
  repoId: Id<"repos">,
  options: SeedIssueOptions = {},
) {
  const githubIssueNumber = options.githubIssueNumber ?? BigInt(42);
  const githubIssueUrl =
    options.githubIssueUrl ??
    `https://github.com/repo-butler/example/issues/${githubIssueNumber.toString()}`;

  return await t.run(async (ctx) => {
    return await ctx.db.insert("issues", {
      repoId,
      githubIssueNumber,
      githubIssueUrl,
      title: options.title ?? "Parser crash",
      body: options.body ?? "Parser fails on empty input.",
      authorLogin: "octocat",
      githubCreatedAt: options.githubCreatedAt ?? "2026-03-29T10:00:00.000Z",
      labels: options.labels ?? [],
      state: options.state ?? "open",
      snapshotedAt: Date.now(),
      createdAt: Date.now(),
    });
  });
}

export async function seedRun(
  t: RepoButlerTest,
  {
    userId,
    repoId,
    issueId,
    runId = "2026-03-29T10:00:00.000Z_repo-butler_example_42",
    status = "pending",
    triggeredBy = "issue_opened",
    startedAt = Date.now(),
    verdict,
    errorMessage,
  }: SeedRunOptions & {
    userId: Id<"users">;
    repoId: Id<"repos">;
    issueId: Id<"issues">;
  },
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("runs", {
      runId,
      userId,
      repoId,
      issueId,
      triggeredBy,
      status,
      startedAt,
      ...(verdict !== undefined ? { verdict } : {}),
      ...(errorMessage !== undefined ? { errorMessage } : {}),
    });
  });
}

export async function seedRepoSettings(
  asUser: RepoButlerAuthedTest,
  repoId: Id<"repos">,
  overrides: Partial<{
    approvalPolicy: "auto_approve" | "require_label" | "require_comment";
    autoApproveThreshold: number;
    maxConcurrentRuns: number;
    maxDailyRuns: number;
    customAreaLabels: string[];
    enabledEventTypes: Array<
      "issues.opened" | "issues.labeled" | "issue_comment.created"
    >;
  }> = {},
) {
  return await asUser.mutation(api.repoSettings.upsert, {
    repoId,
    approvalPolicy: "require_label",
    autoApproveThreshold: 0.7,
    maxConcurrentRuns: 3,
    maxDailyRuns: 20,
    customAreaLabels: [],
    enabledEventTypes: [
      "issues.opened",
      "issues.labeled",
      "issue_comment.created",
    ],
    ...overrides,
  });
}
