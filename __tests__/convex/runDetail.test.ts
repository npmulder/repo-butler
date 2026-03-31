import { describe, expect, it } from "vitest";

import { api } from "@/convex/_generated/api";
import {
  createTestConvex,
  seedInstallation,
  seedIssue,
  seedRepo,
  seedRun,
  seedUser,
} from "@/test-support/convex/testHelpers";

describe("runDetail query", () => {
  it("returns the latest repro iterations within the bounded detail view", async () => {
    const t = createTestConvex();
    const { asUser, userId } = await seedUser(t);
    const installationId = await seedInstallation(t, userId);
    const { repoId } = await seedRepo(t, { installationId, userId });
    const issueId = await seedIssue(t, repoId);
    const runId = await seedRun(t, {
      issueId,
      repoId,
      status: "reproducing",
      userId,
    });

    await t.run(async (ctx) => {
      for (let iteration = 1; iteration <= 10; iteration += 1) {
        await ctx.db.insert("reproRuns", {
          runId,
          schemaVersion: "rb.repro_run.v1",
          iteration: BigInt(iteration),
          sandbox: {
            kind: "docker",
            network: "disabled",
          },
          steps: [],
          durationMs: BigInt(1_000),
          createdAt: Date.now() + iteration,
        });
      }
    });

    const detail = await asUser.query(api.runDetail.getFullRunDetail, { runId });

    expect(
      detail?.reproRuns.map((reproRun) => Number(reproRun.iteration)),
    ).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect(Number(detail?.latestReproRun?.iteration ?? 0)).toBe(10);
  });
});
