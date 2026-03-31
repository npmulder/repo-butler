import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readFixtures } from "./fixtures";
import { calculateMetrics } from "./metrics";
import { createLocalBenchmarkPipeline } from "./pipeline";
import type {
  BenchmarkPipeline,
  BenchmarkResult,
  BenchmarkRunOptions,
  BenchmarkSummaryFile,
  BenchmarkFixture,
} from "./types";

function getDefaultOutputDir(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return path.join(path.dirname(currentFile), "results");
}

function clampConcurrency(value: number): number {
  if (!Number.isFinite(value) || value < 1) {
    return 1;
  }

  return Math.floor(value);
}

function normalizeTimeout(value: number): number {
  if (!Number.isFinite(value) || value < 1) {
    return 1_200;
  }

  return Math.floor(value);
}

function parseArgs(argv: string[]): BenchmarkRunOptions {
  const options: BenchmarkRunOptions = {
    suite: "all",
    maxConcurrent: 3,
    timeout: 1_200,
    outputDir: getDefaultOutputDir(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--suite") {
      const value = argv[index + 1];
      if (value !== "swt-bench" && value !== "tdd-bench" && value !== "all") {
        throw new Error(`Unsupported suite: ${value}`);
      }
      options.suite = value;
      index += 1;
      continue;
    }

    if (argument === "--max-concurrent") {
      options.maxConcurrent = clampConcurrency(Number(argv[index + 1]));
      index += 1;
      continue;
    }

    if (argument === "--timeout") {
      options.timeout = normalizeTimeout(Number(argv[index + 1]));
      index += 1;
      continue;
    }

    if (argument === "--output" || argument === "--output-dir") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${argument} requires a path`);
      }
      options.outputDir = path.resolve(value);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return options;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function writeResults(
  outputDir: string,
  options: BenchmarkRunOptions,
  results: BenchmarkResult[],
  metrics: BenchmarkSummaryFile,
): Promise<void> {
  await fs.mkdir(outputDir, { recursive: true });
  await Promise.all([
    fs.writeFile(
      path.join(outputDir, "results.json"),
      JSON.stringify(results, null, 2),
    ),
    fs.writeFile(
      path.join(outputDir, "metrics.json"),
      JSON.stringify(metrics, null, 2),
    ),
    fs.writeFile(
      path.join(outputDir, "summary.md"),
      [
        "# Benchmark Summary",
        "",
        `- Suite: \`${options.suite}\``,
        `- Generated at: \`${metrics.generatedAt}\``,
        `- Total fixtures: \`${metrics.total}\``,
        `- Triage accuracy: \`${(metrics.triageAccuracy * 100).toFixed(1)}%\``,
        `- Repro success rate: \`${(metrics.reproSuccessRate * 100).toFixed(1)}%\``,
        `- Env setup failure rate: \`${(metrics.envFailureRate * 100).toFixed(1)}%\``,
        `- Verification pass rate: \`${(metrics.verificationPassRate * 100).toFixed(1)}%\``,
        `- Fail-to-pass rate: \`${(metrics.failToPassRate * 100).toFixed(1)}%\``,
        `- Avg iterations: \`${metrics.avgIterations.toFixed(2)}\``,
        `- Avg total time: \`${metrics.avgTotalTimeSeconds.toFixed(1)}s\``,
      ].join("\n"),
    ),
  ]);
}

export async function runSingleFixture(
  fixture: BenchmarkFixture,
  options: Pick<BenchmarkRunOptions, "timeout">,
  pipeline: BenchmarkPipeline,
): Promise<BenchmarkResult> {
  const startTime = Date.now();

  try {
    const triage = await pipeline.runTriage(fixture);
    const triageCorrect =
      triage.classificationType === fixture.groundTruth.classificationType;

    let reproduction = null;
    if (triage.reproEligible) {
      reproduction = await pipeline.runReproduction(
        fixture,
        triage,
        options.timeout,
      );
    }

    let verification = null;
    if (reproduction?.succeeded) {
      verification = await pipeline.runVerification(
        fixture,
        triage,
        reproduction,
        options.timeout,
      );
    }

    let failToPass = null;
    if (reproduction?.succeeded) {
      failToPass = await pipeline.checkFailToPass(
        fixture,
        reproduction,
        options.timeout,
      );
    }

    return {
      fixtureId: fixture.id,
      source: fixture.source,
      difficulty: fixture.difficulty,
      passed: verification?.verdict === "reproduced",
      triageCorrect,
      reproSucceeded: reproduction?.succeeded ?? false,
      verificationVerdict: verification?.verdict ?? null,
      failToPass,
      iterations: reproduction?.iterations ?? 0,
      envSetupFailed: reproduction?.envSetupFailed ?? false,
      totalTimeMs: Date.now() - startTime,
      error: null,
    };
  } catch (error) {
    return {
      fixtureId: fixture.id,
      source: fixture.source,
      difficulty: fixture.difficulty,
      passed: false,
      triageCorrect: false,
      reproSucceeded: false,
      verificationVerdict: null,
      failToPass: null,
      iterations: 0,
      envSetupFailed: false,
      totalTimeMs: Date.now() - startTime,
      error: toErrorMessage(error),
    };
  }
}

export async function runBenchmark(
  options: BenchmarkRunOptions,
  dependencies?: {
    pipeline?: BenchmarkPipeline;
    log?: Pick<Console, "error" | "log">;
  },
): Promise<void> {
  const fixtures = await readFixtures(options.suite);
  const pipeline = dependencies?.pipeline ?? createLocalBenchmarkPipeline();
  const log = dependencies?.log ?? console;
  let completed = 0;
  let passed = 0;

  const results = await mapWithConcurrency(
    fixtures,
    clampConcurrency(options.maxConcurrent),
    async (fixture) => {
      log.log(`\n--- Running: ${fixture.id} ---`);
      const result = await runSingleFixture(fixture, options, pipeline);
      completed += 1;
      if (result.passed) {
        passed += 1;
      }
      log.log(`Progress: ${completed}/${fixtures.length} (${passed} passed)`);
      return result;
    },
  );

  const metrics = calculateMetrics(results);
  const summary: BenchmarkSummaryFile = {
    ...metrics,
    generatedAt: new Date().toISOString(),
    suite: options.suite,
  };
  await writeResults(options.outputDir, options, results, summary);

  log.log("\n=== Benchmark Summary ===");
  log.log(`Total: ${summary.total}`);
  log.log(`Triage accuracy: ${(summary.triageAccuracy * 100).toFixed(1)}%`);
  log.log(`Repro success rate: ${(summary.reproSuccessRate * 100).toFixed(1)}%`);
  log.log(`Env setup failure rate: ${(summary.envFailureRate * 100).toFixed(1)}%`);
  log.log(
    `Verification pass rate: ${(summary.verificationPassRate * 100).toFixed(1)}%`,
  );
  log.log(`Fail-to-pass rate: ${(summary.failToPassRate * 100).toFixed(1)}%`);
  log.log(`Avg iterations to repro: ${summary.avgIterations.toFixed(2)}`);
  log.log(`Avg total time: ${summary.avgTotalTimeSeconds.toFixed(1)}s`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await runBenchmark(options);
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  main().catch((error) => {
    console.error(toErrorMessage(error));
    process.exitCode = 1;
  });
}
