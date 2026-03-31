import type {
  BenchmarkDifficulty,
  BenchmarkMetrics,
  BenchmarkRegressionBaseline,
  BenchmarkResult,
} from "./types";

const DIFFICULTIES: BenchmarkDifficulty[] = ["easy", "medium", "hard"];

function createDifficultyBuckets(): BenchmarkMetrics["byDifficulty"] {
  return {
    easy: { total: 0, passed: 0 },
    medium: { total: 0, passed: 0 },
    hard: { total: 0, passed: 0 },
  };
}

export function calculateMetrics(results: BenchmarkResult[]): BenchmarkMetrics {
  const total = results.length;
  const triageCorrect = results.filter((result) => result.triageCorrect).length;
  const reproSucceeded = results.filter((result) => result.reproSucceeded).length;
  const envFailed = results.filter((result) => result.envSetupFailed).length;
  const verificationPassed = results.filter(
    (result) => result.verificationVerdict === "reproduced",
  ).length;
  const failToPassResults = results.filter(
    (result) => result.failToPass !== null,
  );
  const failToPassPassed = failToPassResults.filter(
    (result) => result.failToPass,
  ).length;
  const successfulRepros = results.filter((result) => result.reproSucceeded);
  const byDifficulty = createDifficultyBuckets();

  for (const result of results) {
    byDifficulty[result.difficulty].total += 1;
    if (result.passed) {
      byDifficulty[result.difficulty].passed += 1;
    }
  }

  return {
    total,
    triageAccuracy: total > 0 ? triageCorrect / total : 0,
    reproSuccessRate: total > 0 ? reproSucceeded / total : 0,
    envFailureRate: total > 0 ? envFailed / total : 0,
    verificationPassRate:
      reproSucceeded > 0 ? verificationPassed / reproSucceeded : 0,
    failToPassRate:
      failToPassResults.length > 0
        ? failToPassPassed / failToPassResults.length
        : 0,
    avgIterations:
      successfulRepros.length > 0
        ? successfulRepros.reduce((sum, result) => sum + result.iterations, 0) /
          successfulRepros.length
        : 0,
    avgTotalTimeSeconds:
      total > 0
        ? results.reduce((sum, result) => sum + result.totalTimeMs, 0) / total / 1000
        : 0,
    byDifficulty,
  };
}

export function checkRegression(
  current: BenchmarkMetrics,
  baseline: BenchmarkRegressionBaseline,
  tolerance = 0.05,
): { regressed: boolean; details: string[] } {
  const details: string[] = [];

  const lowerIsWorse: Array<keyof Pick<
    BenchmarkMetrics,
    "triageAccuracy" | "reproSuccessRate" | "verificationPassRate" | "failToPassRate"
  >> = [
    "triageAccuracy",
    "reproSuccessRate",
    "verificationPassRate",
    "failToPassRate",
  ];

  for (const key of lowerIsWorse) {
    if (current[key] < baseline[key] - tolerance) {
      details.push(
        `${key} regressed: ${(current[key] * 100).toFixed(1)}% vs baseline ${(baseline[key] * 100).toFixed(1)}%`,
      );
    }
  }

  if (current.envFailureRate > baseline.envFailureRate + tolerance) {
    details.push(
      `envFailureRate regressed: ${(current.envFailureRate * 100).toFixed(1)}% vs baseline ${(baseline.envFailureRate * 100).toFixed(1)}%`,
    );
  }

  for (const difficulty of DIFFICULTIES) {
    const currentBucket = current.byDifficulty[difficulty];
    const baselineBucket = baseline.byDifficulty?.[difficulty];

    if (!baselineBucket || baselineBucket.total === 0) {
      continue;
    }

    const currentRate =
      currentBucket.total > 0 ? currentBucket.passed / currentBucket.total : 0;
    const baselineRate = baselineBucket.passed / baselineBucket.total;

    if (currentRate < baselineRate - tolerance) {
      details.push(
        `${difficulty} difficulty pass rate regressed: ${(currentRate * 100).toFixed(1)}% vs baseline ${(baselineRate * 100).toFixed(1)}%`,
      );
    }
  }

  return {
    regressed: details.length > 0,
    details,
  };
}
