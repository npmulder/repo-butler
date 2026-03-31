import { describe, expect, it } from "vitest";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  createTestConvex,
  seedInstallation,
  seedIssue,
  seedRepo,
  seedRun,
  seedUser,
} from "@/test-support/convex/testHelpers";

type VerificationInsert = {
  runId: Id<"runs">;
  repoId?: Id<"repos">;
  schemaVersion: "rb.verification.v1";
  verdict:
    | "reproduced"
    | "not_reproduced"
    | "flaky"
    | "policy_violation"
    | "env_setup_failed"
    | "budget_exhausted";
  determinism: {
    reruns: bigint;
    fails: bigint;
    flakeRate: number;
  };
  policyChecks: {
    networkUsed: boolean;
    secretsAccessed: boolean;
    writesOutsideWorkspace: boolean;
    ranAsRoot: boolean;
  };
  evidence: {
    failingCmd: string;
    exitCode: bigint;
    stderrSha256?: string;
  };
  notes?: string;
  createdAt: number;
};

function buildVerificationDoc(
  runId: Id<"runs">,
  createdAt: number,
  overrides: Partial<VerificationInsert> = {},
): VerificationInsert {
  return {
    runId,
    schemaVersion: "rb.verification.v1",
    verdict: "reproduced",
    determinism: {
      reruns: BigInt(3),
      fails: BigInt(3),
      flakeRate: 0,
    },
    policyChecks: {
      networkUsed: false,
      secretsAccessed: false,
      writesOutsideWorkspace: false,
      ranAsRoot: false,
    },
    evidence: {
      failingCmd: "pnpm test",
      exitCode: BigInt(1),
      stderrSha256: "b".repeat(64),
    },
    createdAt,
    ...overrides,
  };
}

describe("verifications.listVerified", () => {
  it("returns only reproduced verifications for the repo from the indexed path", async () => {
    const t = createTestConvex();
    const { userId, asUser } = await seedUser(t);
    const installationId = await seedInstallation(t, userId);
    const { repoId } = await seedRepo(t, { userId, installationId });
    const { repoId: otherRepoId } = await seedRepo(t, {
      userId,
      installationId,
      name: "other-example",
    });

    const issueId = await seedIssue(t, repoId);
    const otherIssueId = await seedIssue(t, otherRepoId);

    const olderReproducedRunId = await seedRun(t, {
      userId,
      repoId,
      issueId,
      runId: "run_repo_old_reproduced",
      startedAt: 1000,
      verdict: "reproduced",
    });
    const newerReproducedRunId = await seedRun(t, {
      userId,
      repoId,
      issueId,
      runId: "run_repo_new_reproduced",
      startedAt: 2000,
      verdict: "reproduced",
    });
    const ignoredVerdictRunId = await seedRun(t, {
      userId,
      repoId,
      issueId,
      runId: "run_repo_not_reproduced",
      startedAt: 3000,
      verdict: "not_reproduced",
    });
    const otherRepoRunId = await seedRun(t, {
      userId,
      repoId: otherRepoId,
      issueId: otherIssueId,
      runId: "run_other_repo_reproduced",
      startedAt: 4000,
      verdict: "reproduced",
    });

    await t.run(async (ctx) => {
      await ctx.db.insert(
        "verifications",
        buildVerificationDoc(olderReproducedRunId, 1000, { repoId }),
      );
      await ctx.db.insert(
        "verifications",
        buildVerificationDoc(newerReproducedRunId, 3000, { repoId }),
      );
      await ctx.db.insert(
        "verifications",
        buildVerificationDoc(ignoredVerdictRunId, 5000, {
          repoId,
          verdict: "not_reproduced",
          determinism: {
            reruns: BigInt(3),
            fails: BigInt(0),
            flakeRate: 0,
          },
          evidence: {
            failingCmd: "pnpm test",
            exitCode: BigInt(0),
          },
        }),
      );
      await ctx.db.insert(
        "verifications",
        buildVerificationDoc(otherRepoRunId, 4000, { repoId: otherRepoId }),
      );
    });

    const results = await asUser.query(api.verifications.listVerified, {
      repoId,
      limit: 10,
    });

    expect(results.map((verification) => verification.runId)).toEqual([
      newerReproducedRunId,
      olderReproducedRunId,
    ]);
    expect(results.every((verification) => verification.repoId === repoId)).toBe(
      true,
    );
    expect(results.every((verification) => verification.verdict === "reproduced")).toBe(
      true,
    );
  });

  it("supplements indexed results with legacy reproduced rows that do not have repoId", async () => {
    const t = createTestConvex();
    const { userId, asUser } = await seedUser(t);
    const installationId = await seedInstallation(t, userId);
    const { repoId } = await seedRepo(t, { userId, installationId });
    const issueId = await seedIssue(t, repoId);

    const legacyRunId = await seedRun(t, {
      userId,
      repoId,
      issueId,
      runId: "run_legacy_reproduced",
      startedAt: 1000,
    });
    const indexedOlderRunId = await seedRun(t, {
      userId,
      repoId,
      issueId,
      runId: "run_indexed_old_reproduced",
      startedAt: 2000,
      verdict: "reproduced",
    });
    const indexedNewerRunId = await seedRun(t, {
      userId,
      repoId,
      issueId,
      runId: "run_indexed_new_reproduced",
      startedAt: 3000,
      verdict: "reproduced",
    });
    const ignoredLegacyRunId = await seedRun(t, {
      userId,
      repoId,
      issueId,
      runId: "run_legacy_not_reproduced",
      startedAt: 4000,
      verdict: "not_reproduced",
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("verifications", buildVerificationDoc(legacyRunId, 1500));
      await ctx.db.insert(
        "verifications",
        buildVerificationDoc(indexedOlderRunId, 2500, { repoId }),
      );
      await ctx.db.insert(
        "verifications",
        buildVerificationDoc(indexedNewerRunId, 3500, { repoId }),
      );
      await ctx.db.insert(
        "verifications",
        buildVerificationDoc(ignoredLegacyRunId, 4500, {
          verdict: "not_reproduced",
          determinism: {
            reruns: BigInt(3),
            fails: BigInt(0),
            flakeRate: 0,
          },
          evidence: {
            failingCmd: "pnpm test",
            exitCode: BigInt(0),
          },
        }),
      );
    });

    const results = await asUser.query(api.verifications.listVerified, {
      repoId,
      limit: 3,
    });

    expect(results.map((verification) => verification.runId)).toEqual([
      indexedNewerRunId,
      indexedOlderRunId,
      legacyRunId,
    ]);
    expect(results.map((verification) => verification.repoId ?? null)).toEqual([
      repoId,
      repoId,
      null,
    ]);
  });

  it("enforces repo access on the public query", async () => {
    const t = createTestConvex();
    const owner = await seedUser(t, { workosId: "workos|owner" });
    const intruder = await seedUser(t, { workosId: "workos|intruder" });
    const installationId = await seedInstallation(t, owner.userId);
    const { repoId } = await seedRepo(t, {
      userId: owner.userId,
      installationId,
    });

    await expect(
      t.query(api.verifications.listVerified, { repoId, limit: 1 }),
    ).rejects.toThrowError("Not authenticated");
    await expect(
      intruder.asUser.query(api.verifications.listVerified, { repoId, limit: 1 }),
    ).rejects.toThrowError("Not authorized for repo");
  });
});
