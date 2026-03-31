import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  BenchmarkDifficulty,
  BenchmarkFailureKind,
  BenchmarkFixture,
  BenchmarkSuite,
} from "./types";

const BENCHMARKS_DIR = path.dirname(fileURLToPath(import.meta.url));

const SUITE_FILES: Record<BenchmarkSuite, string> = {
  "swt-bench": path.join(BENCHMARKS_DIR, "swt-bench-subset.json"),
  "tdd-bench": path.join(BENCHMARKS_DIR, "tdd-bench-subset.json"),
};

const VALID_DIFFICULTIES = new Set<BenchmarkDifficulty>([
  "easy",
  "medium",
  "hard",
]);
const VALID_FAILURE_KINDS = new Set<BenchmarkFailureKind>([
  "assertion",
  "exception",
  "nonzero_exit",
  "timeout",
]);
const HEX_SHA_PATTERN = /^[0-9a-f]{40}$/i;

function assertObject(
  value: unknown,
  context: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
}

function readRequiredString(
  value: unknown,
  context: string,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${context} must be a non-empty string`);
  }

  return value;
}

function readRequiredNumber(
  value: unknown,
  context: string,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${context} must be a finite number`);
  }

  return value;
}

function readStringArray(
  value: unknown,
  context: string,
): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${context} must be an array`);
  }

  return value.map((entry, index) =>
    readRequiredString(entry, `${context}[${index}]`),
  );
}

function validateSha(sha: string, context: string): string {
  if (!HEX_SHA_PATTERN.test(sha)) {
    throw new Error(`${context} must be a 40-character git SHA`);
  }

  return sha;
}

function parseFixture(
  rawFixture: unknown,
  expectedSource: BenchmarkSuite,
  index: number,
): BenchmarkFixture {
  assertObject(rawFixture, `fixture[${index}]`);
  assertObject(rawFixture.repo, `fixture[${index}].repo`);
  assertObject(rawFixture.issue, `fixture[${index}].issue`);
  assertObject(rawFixture.groundTruth, `fixture[${index}].groundTruth`);
  assertObject(
    rawFixture.groundTruth.failureSignal,
    `fixture[${index}].groundTruth.failureSignal`,
  );

  const source = readRequiredString(rawFixture.source, `fixture[${index}].source`);
  if (source !== expectedSource) {
    throw new Error(
      `fixture[${index}].source must be "${expectedSource}" in ${expectedSource} fixture file`,
    );
  }

  const difficulty = readRequiredString(
    rawFixture.difficulty,
    `fixture[${index}].difficulty`,
  ) as BenchmarkDifficulty;
  if (!VALID_DIFFICULTIES.has(difficulty)) {
    throw new Error(
      `fixture[${index}].difficulty must be one of ${[...VALID_DIFFICULTIES].join(", ")}`,
    );
  }

  const failureKind = readRequiredString(
    rawFixture.groundTruth.failureSignal.kind,
    `fixture[${index}].groundTruth.failureSignal.kind`,
  ) as BenchmarkFailureKind;
  if (!VALID_FAILURE_KINDS.has(failureKind)) {
    throw new Error(
      `fixture[${index}].groundTruth.failureSignal.kind must be one of ${[
        ...VALID_FAILURE_KINDS,
      ].join(", ")}`,
    );
  }

  const classificationType = readRequiredString(
    rawFixture.groundTruth.classificationType,
    `fixture[${index}].groundTruth.classificationType`,
  );
  if (classificationType !== "bug") {
    throw new Error(
      `fixture[${index}].groundTruth.classificationType must be "bug"`,
    );
  }

  return {
    id: readRequiredString(rawFixture.id, `fixture[${index}].id`),
    source,
    difficulty,
    repo: {
      owner: readRequiredString(rawFixture.repo.owner, `fixture[${index}].repo.owner`),
      name: readRequiredString(rawFixture.repo.name, `fixture[${index}].repo.name`),
      ref: readRequiredString(rawFixture.repo.ref, `fixture[${index}].repo.ref`),
      sha: validateSha(
        readRequiredString(rawFixture.repo.sha, `fixture[${index}].repo.sha`),
        `fixture[${index}].repo.sha`,
      ),
      ...(rawFixture.repo.fixSha
        ? {
            fixSha: validateSha(
              readRequiredString(
                rawFixture.repo.fixSha,
                `fixture[${index}].repo.fixSha`,
              ),
              `fixture[${index}].repo.fixSha`,
            ),
          }
        : {}),
      ...(rawFixture.repo.language
        ? {
            language: readRequiredString(
              rawFixture.repo.language,
              `fixture[${index}].repo.language`,
            ),
          }
        : {}),
      ...(rawFixture.repo.runtimeHint
        ? {
            runtimeHint: readRequiredString(
              rawFixture.repo.runtimeHint,
              `fixture[${index}].repo.runtimeHint`,
            ),
          }
        : {}),
    },
    issue: {
      number: readRequiredNumber(rawFixture.issue.number, `fixture[${index}].issue.number`),
      title: readRequiredString(rawFixture.issue.title, `fixture[${index}].issue.title`),
      body: readRequiredString(rawFixture.issue.body, `fixture[${index}].issue.body`),
      url: readRequiredString(rawFixture.issue.url, `fixture[${index}].issue.url`),
      labels: readStringArray(rawFixture.issue.labels, `fixture[${index}].issue.labels`),
      ...(rawFixture.issue.author
        ? {
            author: readRequiredString(
              rawFixture.issue.author,
              `fixture[${index}].issue.author`,
            ),
          }
        : {}),
      ...(rawFixture.issue.createdAt
        ? {
            createdAt: readRequiredString(
              rawFixture.issue.createdAt,
              `fixture[${index}].issue.createdAt`,
            ),
          }
        : {}),
    },
    groundTruth: {
      classificationType: "bug",
      severity: readRequiredString(
        rawFixture.groundTruth.severity,
        `fixture[${index}].groundTruth.severity`,
      ),
      reproExpected:
        typeof rawFixture.groundTruth.reproExpected === "boolean"
          ? rawFixture.groundTruth.reproExpected
          : (() => {
              throw new Error(
                `fixture[${index}].groundTruth.reproExpected must be a boolean`,
              );
            })(),
      failureSignal: {
        kind: failureKind,
        matchAny: readStringArray(
          rawFixture.groundTruth.failureSignal.matchAny,
          `fixture[${index}].groundTruth.failureSignal.matchAny`,
        ),
      },
      ...(rawFixture.groundTruth.knownTestPath
        ? {
            knownTestPath: readRequiredString(
              rawFixture.groundTruth.knownTestPath,
              `fixture[${index}].groundTruth.knownTestPath`,
            ),
          }
        : {}),
      ...(rawFixture.groundTruth.knownFailingTests
        ? {
            knownFailingTests: readStringArray(
              rawFixture.groundTruth.knownFailingTests,
              `fixture[${index}].groundTruth.knownFailingTests`,
            ),
          }
        : {}),
    },
  };
}

export function parseFixtureCollection(
  rawValue: unknown,
  expectedSource: BenchmarkSuite,
): BenchmarkFixture[] {
  if (!Array.isArray(rawValue)) {
    throw new Error(`${expectedSource} fixtures must be a top-level array`);
  }

  const fixtures = rawValue.map((entry, index) =>
    parseFixture(entry, expectedSource, index),
  );
  const ids = new Set<string>();

  for (const fixture of fixtures) {
    if (ids.has(fixture.id)) {
      throw new Error(`Duplicate fixture id detected: ${fixture.id}`);
    }

    ids.add(fixture.id);
  }

  return fixtures;
}

async function readFixtureFile(suite: BenchmarkSuite): Promise<BenchmarkFixture[]> {
  const filePath = SUITE_FILES[suite];
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  return parseFixtureCollection(parsed, suite);
}

export async function readFixtures(
  suite: BenchmarkSuite | "all",
): Promise<BenchmarkFixture[]> {
  if (suite === "all") {
    const [swtFixtures, tddFixtures] = await Promise.all([
      readFixtureFile("swt-bench"),
      readFixtureFile("tdd-bench"),
    ]);
    return [...swtFixtures, ...tddFixtures];
  }

  return await readFixtureFile(suite);
}

export function getFixtureFilePath(suite: BenchmarkSuite): string {
  return SUITE_FILES[suite];
}
