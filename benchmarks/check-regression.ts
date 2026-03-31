import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkRegression } from "./metrics";
import type {
  BenchmarkMetrics,
  BenchmarkRegressionBaseline,
} from "./types";

function getBenchmarksDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

function parseArgs(argv: string[]): {
  baselinePath: string;
  currentPath: string;
  tolerance: number;
} {
  const defaults = {
    baselinePath: path.join(getBenchmarksDir(), "baseline.json"),
    currentPath: path.join(getBenchmarksDir(), "results", "metrics.json"),
    tolerance: 0.05,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--baseline") {
      defaults.baselinePath = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }

    if (argument === "--current") {
      defaults.currentPath = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }

    if (argument === "--tolerance") {
      defaults.tolerance = Number(argv[index + 1]);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return defaults;
}

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

function toMetrics(value: BenchmarkMetrics | BenchmarkRegressionBaseline): BenchmarkMetrics {
  return {
    total: value.total,
    triageAccuracy: value.triageAccuracy,
    reproSuccessRate: value.reproSuccessRate,
    envFailureRate: value.envFailureRate,
    verificationPassRate: value.verificationPassRate,
    failToPassRate: value.failToPassRate,
    avgIterations: value.avgIterations,
    avgTotalTimeSeconds: value.avgTotalTimeSeconds,
    byDifficulty: value.byDifficulty,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const [baseline, current] = await Promise.all([
    readJson<BenchmarkRegressionBaseline>(options.baselinePath),
    readJson<BenchmarkMetrics>(options.currentPath),
  ]);
  const regression = checkRegression(
    toMetrics(current),
    baseline,
    options.tolerance,
  );

  if (regression.regressed) {
    console.error("Benchmark regression detected:");
    for (const detail of regression.details) {
      console.error(`- ${detail}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("No benchmark regression detected.");
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
