import { describe, expect, it } from "vitest";

import { api, internal } from "@/convex/_generated/api";
import {
  createTestConvex,
  seedInstallation,
  seedIssue,
  seedRepo,
  seedRun,
  seedUser,
} from "@/test-support/convex/testHelpers";

function buildReproRun(
  overrides: Partial<{
    iteration: bigint;
    artifactContent: string;
    createdAt: number;
  }> = {},
) {
  return {
    schemaVersion: "rb.repro_run.v1" as const,
    iteration: overrides.iteration ?? BigInt(1),
    sandbox: {
      kind: "docker",
      network: "disabled",
    },
    steps: [],
    ...(overrides.artifactContent !== undefined
      ? { artifactContent: overrides.artifactContent }
      : {}),
    durationMs: BigInt(1_000),
    ...(overrides.createdAt !== undefined
      ? { createdAt: overrides.createdAt }
      : {}),
  };
}

describe("reproRuns.listByRepo", () => {
  it("returns the latest repro run for each run in descending run order", async () => {
    const t = createTestConvex();
    const { userId, asUser } = await seedUser(t);
    const installationId = await seedInstallation(t, userId);
    const { repoId } = await seedRepo(t, { userId, installationId });
    const olderIssueId = await seedIssue(t, repoId, {
      githubIssueNumber: BigInt(1),
    });
    const newerIssueId = await seedIssue(t, repoId, {
      githubIssueNumber: BigInt(2),
    });
    const olderRunId = await seedRun(t, {
      userId,
      repoId,
      issueId: olderIssueId,
      runId: "run_old",
      startedAt: 1_000,
    });
    const newerRunId = await seedRun(t, {
      userId,
      repoId,
      issueId: newerIssueId,
      runId: "run_new",
      startedAt: 2_000,
    });

    await asUser.mutation(api.artifacts.storeReproRun, {
      runId: olderRunId,
      ...buildReproRun({
        artifactContent: "older",
      }),
    });
    await asUser.mutation(api.artifacts.storeReproRun, {
      runId: newerRunId,
      ...buildReproRun({
        artifactContent: "newer-first",
      }),
    });
    const newestReproRunId = await asUser.mutation(api.artifacts.storeReproRun, {
      runId: newerRunId,
      ...buildReproRun({
        iteration: BigInt(2),
        artifactContent: "newer-latest",
      }),
    });

    const results = await asUser.query(api.reproRuns.listByRepo, {
      repoId,
      limit: 10,
    });
    const newerRun = await t.query(internal.runs.getById, { runId: newerRunId });
    const olderRun = await t.query(internal.runs.getById, { runId: olderRunId });

    expect(results.map((reproRun) => reproRun.runId)).toEqual([
      newerRunId,
      olderRunId,
    ]);
    expect(results.map((reproRun) => Number(reproRun.iteration))).toEqual([2, 1]);
    expect(results[0]?._id).toBe(newestReproRunId);
    expect(newerRun?.hasReproRun).toBe(true);
    expect(newerRun?.latestReproRunId).toBe(newestReproRunId);
    expect(olderRun?.hasReproRun).toBe(true);
    expect(olderRun?.latestReproRunId).toBe(results[1]?._id);
  });

  it("preserves legacy ordering for repos without indexed run metadata", async () => {
    const t = createTestConvex();
    const { userId, asUser } = await seedUser(t);
    const installationId = await seedInstallation(t, userId);
    const { repoId } = await seedRepo(t, { userId, installationId });
    const olderIssueId = await seedIssue(t, repoId, {
      githubIssueNumber: BigInt(10),
    });
    const newerIssueId = await seedIssue(t, repoId, {
      githubIssueNumber: BigInt(11),
    });
    const olderRunId = await seedRun(t, {
      userId,
      repoId,
      issueId: olderIssueId,
      runId: "legacy_old",
      startedAt: 10_000,
    });
    const newerRunId = await seedRun(t, {
      userId,
      repoId,
      issueId: newerIssueId,
      runId: "legacy_new",
      startedAt: 20_000,
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("reproRuns", {
        runId: olderRunId,
        schemaVersion: "rb.repro_run.v1",
        iteration: BigInt(1),
        sandbox: {
          kind: "docker",
          network: "disabled",
        },
        steps: [],
        durationMs: BigInt(1_000),
        createdAt: 11_000,
      });
      await ctx.db.insert("reproRuns", {
        runId: newerRunId,
        schemaVersion: "rb.repro_run.v1",
        iteration: BigInt(1),
        sandbox: {
          kind: "docker",
          network: "disabled",
        },
        steps: [],
        durationMs: BigInt(1_000),
        createdAt: 21_000,
      });
      await ctx.db.insert("reproRuns", {
        runId: newerRunId,
        schemaVersion: "rb.repro_run.v1",
        iteration: BigInt(2),
        sandbox: {
          kind: "docker",
          network: "disabled",
        },
        steps: [],
        durationMs: BigInt(1_000),
        createdAt: 22_000,
      });
    });

    const results = await asUser.query(api.reproRuns.listByRepo, {
      repoId,
      limit: 10,
    });

    expect(results.map((reproRun) => reproRun.runId)).toEqual([
      newerRunId,
      olderRunId,
    ]);
    expect(results.map((reproRun) => Number(reproRun.iteration))).toEqual([2, 1]);
  });

  it("keeps the repo auth guard intact", async () => {
    const t = createTestConvex();
    const owner = await seedUser(t, { workosId: "workos|owner" });
    const intruder = await seedUser(t, { workosId: "workos|intruder" });
    const installationId = await seedInstallation(t, owner.userId);
    const { repoId } = await seedRepo(t, {
      userId: owner.userId,
      installationId,
    });
    const issueId = await seedIssue(t, repoId);
    const runId = await seedRun(t, {
      userId: owner.userId,
      repoId,
      issueId,
      runId: "private_run",
    });

    await owner.asUser.mutation(api.artifacts.storeReproRun, {
      runId,
      ...buildReproRun(),
    });

    await expect(
      intruder.asUser.query(api.reproRuns.listByRepo, { repoId }),
    ).rejects.toThrowError("Not authorized for repo");
  });
});
