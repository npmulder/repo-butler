import { describe, expect, it } from "vitest";

import { api } from "@/convex/_generated/api";
import {
  createTestConvex,
  seedInstallation,
  seedRepo,
  seedUser,
} from "@/test-support/convex/testHelpers";

describe("issues queries", () => {
  it("loads an issue snapshot through the snapshotted index", async () => {
    const t = createTestConvex();
    const { userId, asUser } = await seedUser(t);
    const installationId = await seedInstallation(t, userId);
    const { repoId } = await seedRepo(t, { userId, installationId });
    const snapshottedAt = Date.now();

    await t.run(async (ctx) => {
      await ctx.db.insert("issues", {
        authorLogin: "octocat",
        createdAt: snapshottedAt,
        githubCreatedAt: "2026-03-29T10:00:00.000Z",
        githubIssueNumber: BigInt(42),
        githubIssueUrl: "https://github.com/repo-butler/example/issues/42",
        labels: [],
        repoId,
        snapshottedAt,
        state: "open",
        title: "Issue snapshot",
      });
    });

    const issue = await asUser.query(api.issues.getByGithubIssue, {
      githubIssueNumber: BigInt(42),
      repoId,
    });

    expect(issue?.title).toBe("Issue snapshot");
    expect(issue?.snapshottedAt).toBe(snapshottedAt);
  });

  it("lists snapshots sorted by snapshottedAt", async () => {
    const t = createTestConvex();
    const { userId, asUser } = await seedUser(t);
    const installationId = await seedInstallation(t, userId);
    const { repoId } = await seedRepo(t, { userId, installationId });
    const olderTimestamp = Date.now() - 1_000;
    const newerTimestamp = Date.now();

    await t.run(async (ctx) => {
      await ctx.db.insert("issues", {
        authorLogin: "octocat",
        createdAt: olderTimestamp,
        githubCreatedAt: "2026-03-29T10:00:00.000Z",
        githubIssueNumber: BigInt(1),
        githubIssueUrl: "https://github.com/repo-butler/example/issues/1",
        labels: [],
        repoId,
        snapshottedAt: olderTimestamp,
        state: "open",
        title: "Older snapshot",
      });

      await ctx.db.insert("issues", {
        authorLogin: "octocat",
        createdAt: newerTimestamp,
        githubCreatedAt: "2026-03-29T10:00:01.000Z",
        githubIssueNumber: BigInt(2),
        githubIssueUrl: "https://github.com/repo-butler/example/issues/2",
        labels: [],
        repoId,
        snapshottedAt: newerTimestamp,
        state: "open",
        title: "Newer snapshot",
      });
    });

    const issues = await asUser.query(api.issues.listByRepo, { repoId });

    expect(issues).toHaveLength(2);
    expect(issues.map((issue) => issue.title)).toEqual([
      "Newer snapshot",
      "Older snapshot",
    ]);
  });
});
