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

function compareRunIds(left: string, right: string) {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
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

  it("falls back when the denormalized latest repro pointer targets another run", async () => {
    const t = createTestConvex();
    const owner = await seedUser(t, { workosId: "workos|owner" });
    const otherOwner = await seedUser(t, { workosId: "workos|other-owner" });
    const ownerInstallationId = await seedInstallation(t, owner.userId, BigInt(2001));
    const otherInstallationId = await seedInstallation(
      t,
      otherOwner.userId,
      BigInt(2002),
    );
    const { repoId } = await seedRepo(t, {
      userId: owner.userId,
      installationId: ownerInstallationId,
      name: "owned-repo",
    });
    const { repoId: otherRepoId } = await seedRepo(t, {
      userId: otherOwner.userId,
      installationId: otherInstallationId,
      name: "other-repo",
    });
    const issueId = await seedIssue(t, repoId, {
      githubIssueNumber: BigInt(20),
    });
    const otherIssueId = await seedIssue(t, otherRepoId, {
      githubIssueNumber: BigInt(21),
    });
    const runId = await seedRun(t, {
      userId: owner.userId,
      repoId,
      issueId,
      runId: "owned-run",
      startedAt: 30_000,
    });
    const otherRunId = await seedRun(t, {
      userId: otherOwner.userId,
      repoId: otherRepoId,
      issueId: otherIssueId,
      runId: "other-run",
      startedAt: 31_000,
    });

    const validReproRunId = await owner.asUser.mutation(api.artifacts.storeReproRun, {
      runId,
      ...buildReproRun({
        artifactContent: "owned",
      }),
    });
    const foreignReproRunId = await otherOwner.asUser.mutation(
      api.artifacts.storeReproRun,
      {
        runId: otherRunId,
        ...buildReproRun({
          artifactContent: "foreign",
        }),
      },
    );

    await t.run(async (ctx) => {
      await ctx.db.patch(runId, {
        latestReproRunId: foreignReproRunId,
      });
    });

    const results = await owner.asUser.query(api.reproRuns.listByRepo, {
      repoId,
      limit: 10,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?._id).toBe(validReproRunId);
    expect(results[0]?.runId).toBe(runId);
  });

  it("uses a deterministic tie-breaker when indexed and legacy runs share startedAt", async () => {
    const t = createTestConvex();
    const { userId, asUser } = await seedUser(t);
    const installationId = await seedInstallation(t, userId);
    const { repoId } = await seedRepo(t, { userId, installationId });
    const indexedIssueId = await seedIssue(t, repoId, {
      githubIssueNumber: BigInt(30),
    });
    const legacyIssueId = await seedIssue(t, repoId, {
      githubIssueNumber: BigInt(31),
    });
    const indexedRunId = await seedRun(t, {
      userId,
      repoId,
      issueId: indexedIssueId,
      runId: "indexed-tie",
      startedAt: 40_000,
    });
    const legacyRunId = await seedRun(t, {
      userId,
      repoId,
      issueId: legacyIssueId,
      runId: "legacy-tie",
      startedAt: 40_000,
    });

    const indexedReproRunId = await asUser.mutation(api.artifacts.storeReproRun, {
      runId: indexedRunId,
      ...buildReproRun({
        artifactContent: "indexed",
      }),
    });

    const legacyReproRunId = await t.run(async (ctx) => {
      return await ctx.db.insert("reproRuns", {
        runId: legacyRunId,
        schemaVersion: "rb.repro_run.v1",
        iteration: BigInt(1),
        sandbox: {
          kind: "docker",
          network: "disabled",
        },
        steps: [],
        artifactContent: "legacy",
        durationMs: BigInt(1_000),
        createdAt: 40_500,
      });
    });

    const results = await asUser.query(api.reproRuns.listByRepo, {
      repoId,
      limit: 10,
    });
    const expectedRunIds = [indexedRunId, legacyRunId].sort(compareRunIds);

    expect(results.map((reproRun) => reproRun.runId)).toEqual(expectedRunIds);
    expect(
      new Map(results.map((reproRun) => [reproRun.runId, reproRun._id])),
    ).toEqual(
      new Map([
        [indexedRunId, indexedReproRunId],
        [legacyRunId, legacyReproRunId],
      ]),
    );
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
