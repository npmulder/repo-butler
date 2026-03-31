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

describe("runs.create", () => {
  it("generates a runId and stores a pending run", async () => {
    const t = createTestConvex();
    const { userId } = await seedUser(t);
    const installationId = await seedInstallation(t, userId);
    const { repoId, fullName } = await seedRepo(t, { userId, installationId });
    const issueId = await seedIssue(t, repoId, { githubIssueNumber: BigInt(42) });

    const runId = await t.mutation(internal.runs.create, {
      issueId,
      repoId,
      triggeredBy: "manual",
    });

    const run = await t.query(internal.runs.getById, { runId });

    expect(run).toMatchObject({
      _id: runId,
      issueId,
      repoId,
      userId,
      triggeredBy: "manual",
      status: "pending",
    });
    expect(run?.runId).toContain(fullName);
    expect(run?.runId).toContain("_42");
  });
});

describe("runs.updateStatus", () => {
  it("transitions a run through triaging, awaiting approval, and completed", async () => {
    const t = createTestConvex();
    const { userId } = await seedUser(t);
    const installationId = await seedInstallation(t, userId);
    const { repoId } = await seedRepo(t, { userId, installationId });
    const issueId = await seedIssue(t, repoId);
    const runId = await seedRun(t, { userId, repoId, issueId });

    await t.mutation(internal.runs.updateStatus, {
      runId,
      status: "triaging",
    });
    await t.mutation(internal.runs.updateStatus, {
      runId,
      status: "awaiting_approval",
    });
    await t.mutation(internal.runs.updateStatus, {
      runId,
      status: "completed",
    });

    const run = await t.query(internal.runs.getById, { runId });

    expect(run?.status).toBe("completed");
    expect(run?.completedAt).toBeTypeOf("number");
  });

  it.each(["completed", "report_failed", "failed", "cancelled"] as const)(
    "sets completedAt when moved to %s",
    async (status) => {
      const t = createTestConvex();
      const { userId } = await seedUser(t);
      const installationId = await seedInstallation(t, userId);
      const { repoId } = await seedRepo(t, { userId, installationId });
      const issueId = await seedIssue(t, repoId);
      const runId = await seedRun(t, { userId, repoId, issueId });

      await t.mutation(internal.runs.updateStatus, {
        runId,
        status,
      });

      const run = await t.query(internal.runs.getById, { runId });
      expect(run?.completedAt).toBeTypeOf("number");
    },
  );

  it("patches verdict and error details", async () => {
    const t = createTestConvex();
    const { userId } = await seedUser(t);
    const installationId = await seedInstallation(t, userId);
    const { repoId } = await seedRepo(t, { userId, installationId });
    const issueId = await seedIssue(t, repoId);
    const runId = await seedRun(t, { userId, repoId, issueId });

    await t.mutation(internal.runs.updateStatus, {
      runId,
      status: "failed",
      verdict: "env_setup_failed",
      errorMessage: "Sandbox image could not boot",
    });

    const run = await t.query(internal.runs.getById, { runId });

    expect(run).toMatchObject({
      status: "failed",
      verdict: "env_setup_failed",
      errorMessage: "Sandbox image could not boot",
    });
    expect(run?.completedAt).toBeTypeOf("number");
  });
});

describe("runs queries", () => {
  it("returns getByRunId, listRecent, and listByRepo results for the owning user", async () => {
    const t = createTestConvex();
    const { userId, asUser } = await seedUser(t);
    const installationId = await seedInstallation(t, userId);
    const { repoId } = await seedRepo(t, { userId, installationId });
    const issueOneId = await seedIssue(t, repoId, { githubIssueNumber: BigInt(1) });
    const issueTwoId = await seedIssue(t, repoId, { githubIssueNumber: BigInt(2) });
    const olderRunId = await seedRun(t, {
      userId,
      repoId,
      issueId: issueOneId,
      runId: "run_old",
      startedAt: Date.now() - 1000,
    });
    const newerRunId = await seedRun(t, {
      userId,
      repoId,
      issueId: issueTwoId,
      runId: "run_new",
      startedAt: Date.now(),
    });

    const byId = await asUser.query(api.runs.getByRunId, { runId: "run_new" });
    const recent = await asUser.query(api.runs.listRecent, { limit: BigInt(2) });
    const byRepo = await asUser.query(api.runs.listByRepo, { repoId });

    expect(byId?._id).toBe(newerRunId);
    expect(recent.map((run) => run._id)).toEqual([newerRunId, olderRunId]);
    expect(byRepo.map((run) => run._id)).toEqual([newerRunId, olderRunId]);
  });

  it("enforces auth guards on public queries", async () => {
    const t = createTestConvex();
    const owner = await seedUser(t, { workosId: "workos|owner" });
    const intruder = await seedUser(t, { workosId: "workos|intruder" });
    const installationId = await seedInstallation(t, owner.userId);
    const { repoId } = await seedRepo(t, {
      userId: owner.userId,
      installationId,
    });
    const issueId = await seedIssue(t, repoId);
    await seedRun(t, {
      userId: owner.userId,
      repoId,
      issueId,
      runId: "run_private",
    });

    await expect(
      t.query(api.runs.listRecent, { limit: BigInt(1) }),
    ).rejects.toThrowError("Not authenticated");
    await expect(
      intruder.asUser.query(api.runs.listByRepo, { repoId }),
    ).rejects.toThrowError("Not authorized for repo");
    await expect(
      intruder.asUser.query(api.runs.getByRunId, { runId: "run_private" }),
    ).rejects.toThrowError("Not authorized for run");
  });
});
