// @vitest-environment node

import { describe, expect, it } from "vitest";

import { parseFixtureCollection } from "../benchmarks/fixtures";
import { checkRegression, calculateMetrics } from "../benchmarks/metrics";
import { evaluateFailToPass } from "../benchmarks/pipeline";
import type {
  BenchmarkFixture,
  BenchmarkRegressionBaseline,
  BenchmarkResult,
} from "../benchmarks/types";
import type { ReproPlan } from "../lib/generated/repro-plan.v1";
import type { SandboxRequest, SandboxResult } from "../worker/types";

function makeResult(
  overrides: Partial<BenchmarkResult> = {},
): BenchmarkResult {
  return {
    fixtureId: "fixture-1",
    source: "swt-bench",
    difficulty: "easy",
    passed: true,
    triageCorrect: true,
    reproSucceeded: true,
    verificationVerdict: "reproduced",
    failToPass: true,
    iterations: 2,
    envSetupFailed: false,
    totalTimeMs: 8_000,
    error: null,
    ...overrides,
  };
}

function makeFixture(): BenchmarkFixture {
  return {
    id: "fixture-1",
    source: "swt-bench",
    difficulty: "easy",
    repo: {
      owner: "example",
      name: "repo",
      ref: "main",
      sha: "1111111111111111111111111111111111111111",
      fixSha: "2222222222222222222222222222222222222222",
      language: "python",
    },
    issue: {
      number: 1,
      title: "Example bug",
      body: "Reproduction body",
      url: "https://github.com/example/repo/pull/1",
      labels: [],
      author: "author",
      createdAt: "2026-03-31T00:00:00Z",
    },
    groundTruth: {
      classificationType: "bug",
      severity: "medium",
      reproExpected: true,
      failureSignal: {
        kind: "assertion",
        matchAny: ["AssertionError"],
      },
      knownTestPath: "tests/test_example.py",
      knownFailingTests: ["tests/test_example.py::test_bug"],
    },
  };
}

function makePlanArtifact(): ReproPlan {
  return {
    schema_version: "rb.repro_plan.v1",
    run_id: "fixture-1",
    base_revision: {
      ref: "refs/heads/main",
      sha: "1111111111111111111111111111111111111111",
    },
    environment_strategy: {
      preferred: "bootstrap",
      detected: "bootstrap",
      fallbacks: [],
      notes: "unit-test fixture",
    },
    commands: [
      {
        cwd: ".",
        cmd: "pytest tests/test_example.py",
      },
    ],
    artifact: {
      type: "pytest_test",
      path: "tests/test_example.py",
      entrypoint: "test_bug",
    },
  };
}

function makeSandboxResult(
  request: SandboxRequest,
  status: SandboxResult["status"],
  exitCode: number,
): SandboxResult {
  return {
    runId: request.runId,
    status,
    ...(status === "success"
      ? {}
      : { failureType: "repro_failure" as const }),
    sandbox: {
      kind: "docker",
      imageDigest: "sha256:test",
      network: "disabled",
      uid: 1000,
    },
    steps: [
      {
        name: "run_test",
        cmd: "pytest tests/test_example.py",
        exitCode,
        stdoutSha256: "a".repeat(64),
        stderrSha256: "b".repeat(64),
        durationMs: 100,
        stdoutTail: "",
        stderrTail: exitCode === 0 ? "" : "AssertionError",
      },
    ],
    totalDurationMs: 100,
  };
}

describe("calculateMetrics", () => {
  it("computes rates, averages, and difficulty buckets from known results", () => {
    const metrics = calculateMetrics([
      makeResult(),
      makeResult({
        fixtureId: "fixture-2",
        difficulty: "medium",
        passed: false,
        verificationVerdict: "not_reproduced",
        failToPass: false,
        iterations: 3,
        totalTimeMs: 12_000,
      }),
      makeResult({
        fixtureId: "fixture-3",
        difficulty: "hard",
        passed: false,
        triageCorrect: false,
        reproSucceeded: false,
        verificationVerdict: null,
        failToPass: null,
        iterations: 0,
        envSetupFailed: true,
        totalTimeMs: 10_000,
      }),
    ]);

    expect(metrics.total).toBe(3);
    expect(metrics.triageAccuracy).toBeCloseTo(2 / 3);
    expect(metrics.reproSuccessRate).toBeCloseTo(2 / 3);
    expect(metrics.envFailureRate).toBeCloseTo(1 / 3);
    expect(metrics.verificationPassRate).toBeCloseTo(1 / 2);
    expect(metrics.failToPassRate).toBeCloseTo(1 / 2);
    expect(metrics.avgIterations).toBeCloseTo(2.5);
    expect(metrics.avgTotalTimeSeconds).toBeCloseTo(10);
    expect(metrics.byDifficulty.easy).toEqual({ total: 1, passed: 1 });
    expect(metrics.byDifficulty.medium).toEqual({ total: 1, passed: 0 });
    expect(metrics.byDifficulty.hard).toEqual({ total: 1, passed: 0 });
  });
});

describe("checkRegression", () => {
  it("flags regressions outside tolerance and passes within tolerance", () => {
    const baseline: BenchmarkRegressionBaseline = {
      total: 10,
      triageAccuracy: 0.9,
      reproSuccessRate: 0.8,
      envFailureRate: 0.1,
      verificationPassRate: 0.75,
      failToPassRate: 0.7,
      avgIterations: 2,
      avgTotalTimeSeconds: 30,
      byDifficulty: {
        easy: { total: 4, passed: 4 },
        medium: { total: 3, passed: 2 },
        hard: { total: 3, passed: 1 },
      },
      date: "2026-03-31",
      notes: "baseline",
    };

    const stable = checkRegression(
      {
        ...baseline,
        triageAccuracy: 0.87,
        envFailureRate: 0.12,
      },
      baseline,
      0.05,
    );
    expect(stable.regressed).toBe(false);

    const regressed = checkRegression(
      {
        ...baseline,
        reproSuccessRate: 0.6,
        envFailureRate: 0.2,
      },
      baseline,
      0.05,
    );
    expect(regressed.regressed).toBe(true);
    expect(regressed.details).toEqual(
      expect.arrayContaining([
        expect.stringContaining("reproSuccessRate regressed"),
        expect.stringContaining("envFailureRate regressed"),
      ]),
    );
  });
});

describe("parseFixtureCollection", () => {
  it("rejects malformed fixtures with clear validation errors", () => {
    const rawFixture = {
      ...makeFixture(),
      repo: {
        ...makeFixture().repo,
      },
    } as unknown as Record<string, unknown>;

    delete (rawFixture.repo as Record<string, unknown>).sha;

    expect(() => parseFixtureCollection([rawFixture], "swt-bench")).toThrow(
      "fixture[0].repo.sha must be a non-empty string",
    );
  });
});

describe("evaluateFailToPass", () => {
  it("passes only when the artifact fails on the buggy SHA and passes on the fix SHA", async () => {
    const fixture = makeFixture();
    const reproduction = {
      succeeded: true,
      artifact: {
        file_path: "tests/test_example.py",
        content: "def test_bug(): assert False",
        language: "python" as const,
      },
      iterations: 1,
      envSetupFailed: false,
      planArtifact: makePlanArtifact(),
      lastSandboxResult: undefined,
      runArtifact: undefined,
    };

    const result = await evaluateFailToPass(
      fixture,
      reproduction,
      300,
      async (request) => {
        if (request.repo.sha === fixture.repo.sha) {
          return makeSandboxResult(request, "failure", 1);
        }

        return makeSandboxResult(request, "success", 0);
      },
    );

    expect(result).toBe(true);
  });
});
