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

function buildTriageArtifact(
  runId: string,
  overrides: Partial<{
    confidence: number;
    labelsSuggested: string[];
    reproEligible: boolean;
    summary: string;
  }> = {},
) {
  return {
    schema_version: "rb.triage.v1" as const,
    run_id: runId,
    repo: {
      owner: "repo-butler",
      name: "example",
      default_branch: "main",
    },
    issue: {
      number: 42,
      title: "Parser crash",
      url: "https://github.com/repo-butler/example/issues/42",
    },
    classification: {
      type: "bug" as const,
      area: ["parser"],
      severity: "high" as const,
      labels_suggested: overrides.labelsSuggested ?? ["type:bug"],
      confidence: overrides.confidence ?? 0.91,
    },
    repro_hypothesis: {
      minimal_steps_guess: ["Run the parser against an empty YAML file."],
      expected_failure_signal: {
        kind: "exception" as const,
        match_any: ["ParseError"],
      },
      environment_assumptions: {
        os: "Ubuntu 22.04",
        runtime: "Node 20.x",
      },
    },
    repro_eligible: overrides.reproEligible ?? true,
    summary:
      overrides.summary ??
      "The parser crashes on empty YAML input with a ParseError.",
  };
}

function buildReproContract() {
  return {
    schemaVersion: "rb.repro_contract.v1" as const,
    acceptance: {
      artifactType: "test" as const,
      mustFailOnBaseRevision: true,
      mustBeDeterministic: {
        reruns: BigInt(3),
        allowedFlakeRate: 0,
      },
      mustNotRequireNetwork: true,
      failureSignal: {
        kind: "assertion" as const,
        matchAny: ["expected false to be true"],
      },
    },
    sandboxPolicy: {
      network: "disabled" as const,
      runAsRoot: false,
      secretsMount: "none" as const,
    },
    budgets: {
      wallClockSeconds: BigInt(600),
      maxIterations: BigInt(3),
    },
  };
}

function buildReproPlan() {
  return {
    schemaVersion: "rb.repro_plan.v1" as const,
    baseRevision: {
      ref: "refs/heads/main",
      sha: "deadbeef",
    },
    environmentStrategy: {
      preferred: "dockerfile" as const,
      detected: "dockerfile" as const,
      fallbacks: ["synth_dockerfile", "bootstrap"] as Array<
        "synth_dockerfile" | "bootstrap"
      >,
      notes: "Use the repository Dockerfile first.",
      imageUsed: "rb-repro-123",
    },
    commands: [
      {
        cwd: "/workspace",
        cmd: "pnpm test",
      },
    ],
    artifact: {
      type: "test",
      path: "tests/repro.spec.ts",
      entrypoint: "tests/repro.spec.ts",
    },
  };
}

function buildReproRun() {
  return {
    schemaVersion: "rb.repro_run.v1" as const,
    iteration: BigInt(1),
    sandbox: {
      kind: "docker",
      network: "disabled",
      uid: BigInt(1000),
    },
    steps: [
      {
        name: "run tests",
        cmd: "pnpm test",
        exitCode: BigInt(1),
        stderrSha256: "a".repeat(64),
        durationMs: BigInt(1234),
      },
    ],
    failureObserved: {
      kind: "assertion",
      matchAny: ["expected false to be true"],
    },
    failureType: "repro_failure" as const,
    environmentStrategy: {
      attempted: "dockerfile" as const,
      detected: "dockerfile" as const,
      imageUsed: "rb-repro-123",
    },
    artifactContent: "failing test body",
    durationMs: BigInt(1234),
  };
}

function buildVerification(
  verdict: "reproduced" | "not_reproduced" = "reproduced",
) {
  return {
    schemaVersion: "rb.verification.v1" as const,
    verdict,
    determinism: {
      reruns: BigInt(3),
      fails: verdict === "reproduced" ? BigInt(3) : BigInt(0),
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
      exitCode: verdict === "reproduced" ? BigInt(1) : BigInt(0),
      stderrSha256: "b".repeat(64),
    },
    notes: "Verification notes.",
  };
}

describe("artifacts.storeTriage", () => {
  it("stores a valid triage artifact", async () => {
    const t = createTestConvex();
    const { userId } = await seedUser(t);
    const installationId = await seedInstallation(t, userId);
    const { repoId } = await seedRepo(t, { userId, installationId });
    const issueId = await seedIssue(t, repoId);
    const runId = await seedRun(t, {
      userId,
      repoId,
      issueId,
      runId: "run_triage_store",
    });

    await t.mutation(internal.artifacts.storeTriage, {
      runId,
      artifact: buildTriageArtifact("run_triage_store"),
      tokensUsed: {
        input: 321,
        output: 123,
      },
    });

    const triage = await t.run(async (ctx) => {
      return await ctx.db
        .query("triageResults")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .unique();
    });

    expect(triage).toMatchObject({
      runId,
      repoId,
      issueId,
      schemaVersion: "rb.triage.v1",
      confidence: 0.91,
      reproEligible: true,
    });
  });

  it("rejects empty suggested labels", async () => {
    const t = createTestConvex();
    const { userId } = await seedUser(t);
    const installationId = await seedInstallation(t, userId);
    const { repoId } = await seedRepo(t, { userId, installationId });
    const issueId = await seedIssue(t, repoId);
    const runId = await seedRun(t, {
      userId,
      repoId,
      issueId,
      runId: "run_triage_empty_labels",
    });

    await expect(
      t.mutation(internal.artifacts.storeTriage, {
        runId,
        artifact: buildTriageArtifact("run_triage_empty_labels", {
          labelsSuggested: [],
        }),
        tokensUsed: {
          input: 10,
          output: 5,
        },
      }),
    ).rejects.toThrowError("classification.labels_suggested must not be empty");
  });

  it("rejects out-of-range confidence values", async () => {
    const t = createTestConvex();
    const { userId } = await seedUser(t);
    const installationId = await seedInstallation(t, userId);
    const { repoId } = await seedRepo(t, { userId, installationId });
    const issueId = await seedIssue(t, repoId);
    const runId = await seedRun(t, {
      userId,
      repoId,
      issueId,
      runId: "run_triage_bad_confidence",
    });

    await expect(
      t.mutation(internal.artifacts.storeTriage, {
        runId,
        artifact: buildTriageArtifact("run_triage_bad_confidence", {
          confidence: 1.5,
        }),
        tokensUsed: {
          input: 10,
          output: 5,
        },
      }),
    ).rejects.toThrowError("classification.confidence must be between 0 and 1");
  });

  it("upserts triage artifacts while preserving createdAt", async () => {
    const t = createTestConvex();
    const { userId } = await seedUser(t);
    const installationId = await seedInstallation(t, userId);
    const { repoId } = await seedRepo(t, { userId, installationId });
    const issueId = await seedIssue(t, repoId);
    const runId = await seedRun(t, {
      userId,
      repoId,
      issueId,
      runId: "run_triage_upsert",
    });

    await t.mutation(internal.artifacts.storeTriage, {
      runId,
      artifact: buildTriageArtifact("run_triage_upsert", {
        summary: "Initial summary.",
      }),
      tokensUsed: {
        input: 100,
        output: 50,
      },
    });

    const first = await t.run(async (ctx) => {
      return await ctx.db
        .query("triageResults")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .unique();
    });

    await t.mutation(internal.artifacts.storeTriage, {
      runId,
      artifact: buildTriageArtifact("run_triage_upsert", {
        summary: "Updated summary.",
        confidence: 0.73,
      }),
      tokensUsed: {
        input: 200,
        output: 90,
      },
    });

    const second = await t.run(async (ctx) => {
      return await ctx.db
        .query("triageResults")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .collect();
    });

    expect(first?.createdAt).toBeDefined();
    expect(second).toHaveLength(1);
    expect(second[0].createdAt).toBe(first?.createdAt);
    expect(second[0].summary).toBe("Updated summary.");
    expect(second[0].confidence).toBe(0.73);
  });
});

describe("artifact public mutations and queries", () => {
  it("stores and upserts repro contract, plan, run, and verification artifacts", async () => {
    const t = createTestConvex();
    const { userId, asUser } = await seedUser(t);
    const installationId = await seedInstallation(t, userId);
    const { repoId } = await seedRepo(t, { userId, installationId });
    const issueId = await seedIssue(t, repoId);
    const runId = await seedRun(t, {
      userId,
      repoId,
      issueId,
      runId: "run_public_artifacts",
    });

    await asUser.mutation(api.artifacts.storeReproContract, {
      runId,
      ...buildReproContract(),
    });
    await asUser.mutation(api.artifacts.storeReproPlan, {
      runId,
      ...buildReproPlan(),
    });
    await asUser.mutation(api.artifacts.storeReproRun, {
      runId,
      ...buildReproRun(),
    });
    await asUser.mutation(api.artifacts.storeVerification, {
      runId,
      ...buildVerification("reproduced"),
    });

    const firstBundle = await asUser.query(api.artifacts.getRunBundle, {
      runId,
    });

    expect(firstBundle).not.toBeNull();
    expect(firstBundle?.contract).not.toBeNull();
    expect(firstBundle?.plan).not.toBeNull();
    expect(firstBundle?.reproRuns).toHaveLength(1);
    expect(firstBundle?.verification).not.toBeNull();
    expect(firstBundle?.run.status).toBe("completed");
    expect(firstBundle?.run.verdict).toBe("reproduced");

    const contractCreatedAt = firstBundle?.contract?.createdAt;
    const planCreatedAt = firstBundle?.plan?.createdAt;
    const reproRunCreatedAt = firstBundle?.reproRuns[0]?.createdAt;
    const verificationCreatedAt = firstBundle?.verification?.createdAt;

    await asUser.mutation(api.artifacts.storeReproContract, {
      runId,
      ...buildReproContract(),
      budgets: {
        wallClockSeconds: BigInt(900),
        maxIterations: BigInt(5),
      },
    });
    await asUser.mutation(api.artifacts.storeReproPlan, {
      runId,
      ...buildReproPlan(),
      environmentStrategy: {
        preferred: "bootstrap" as const,
        detected: "bootstrap" as const,
        fallbacks: [],
        notes: "Fallback order changed.",
        imageUsed: "ubuntu:22.04",
      },
    });
    await asUser.mutation(api.artifacts.storeReproRun, {
      runId,
      ...buildReproRun(),
      artifactContent: "updated failing artifact",
    });
    await asUser.mutation(api.artifacts.storeVerification, {
      runId,
      ...buildVerification("not_reproduced"),
    });

    const updatedBundle = await asUser.query(api.artifacts.getRunBundle, {
      runId,
    });

    expect(updatedBundle?.contract?.createdAt).toBe(contractCreatedAt);
    expect(updatedBundle?.plan?.createdAt).toBe(planCreatedAt);
    expect(updatedBundle?.reproRuns[0]?.createdAt).toBe(reproRunCreatedAt);
    expect(updatedBundle?.verification?.createdAt).toBe(verificationCreatedAt);
    expect(updatedBundle?.contract?.budgets.wallClockSeconds).toBe(BigInt(900));
    expect(updatedBundle?.plan?.environmentStrategy.preferred).toBe(
      "bootstrap",
    );
    expect(updatedBundle?.reproRuns[0]?.artifactContent).toBe(
      "updated failing artifact",
    );
    expect(updatedBundle?.verification?.verdict).toBe("not_reproduced");
    expect(updatedBundle?.run.status).toBe("failed");
  });

  it("returns the full pipeline state from getRunBundle", async () => {
    const t = createTestConvex();
    const { userId, asUser } = await seedUser(t);
    const installationId = await seedInstallation(t, userId);
    const { repoId } = await seedRepo(t, { userId, installationId });
    const issueId = await seedIssue(t, repoId);
    const runId = await seedRun(t, {
      userId,
      repoId,
      issueId,
      runId: "run_bundle",
    });

    await t.mutation(internal.artifacts.storeTriage, {
      runId,
      artifact: buildTriageArtifact("run_bundle"),
      tokensUsed: {
        input: 123,
        output: 45,
      },
    });
    await asUser.mutation(api.artifacts.storeReproContract, {
      runId,
      ...buildReproContract(),
    });
    await asUser.mutation(api.artifacts.storeReproPlan, {
      runId,
      ...buildReproPlan(),
    });
    await asUser.mutation(api.artifacts.storeReproRun, {
      runId,
      ...buildReproRun(),
    });
    await asUser.mutation(api.artifacts.storeVerification, {
      runId,
      ...buildVerification("reproduced"),
    });

    const bundle = await asUser.query(api.artifacts.getRunBundle, { runId });

    expect(bundle).toMatchObject({
      run: expect.objectContaining({ _id: runId }),
      issue: expect.objectContaining({ _id: issueId }),
      triage: expect.objectContaining({ runId }),
      contract: expect.objectContaining({ runId }),
      plan: expect.objectContaining({ runId }),
      verification: expect.objectContaining({ runId }),
    });
    expect(bundle?.reproRuns).toHaveLength(1);
  });

  it("enforces requireRunAccess on public mutations and queries", async () => {
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
      runId: "run_private_artifacts",
    });

    await expect(
      t.mutation(api.artifacts.storeReproContract, {
        runId,
        ...buildReproContract(),
      }),
    ).rejects.toThrowError("Not authenticated");

    await expect(
      intruder.asUser.mutation(api.artifacts.storeReproPlan, {
        runId,
        ...buildReproPlan(),
      }),
    ).rejects.toThrowError("Not authorized for run");

    await expect(
      intruder.asUser.query(api.artifacts.getRunBundle, { runId }),
    ).rejects.toThrowError("Not authorized for run");
  });
});
