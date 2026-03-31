import type { ReproArtifactToolOutput } from "../lib/repro-parser";
import type { ReproPlan } from "../lib/generated/repro-plan.v1";
import type { ReproRun } from "../lib/generated/repro-run.v1";
import type { TriageArtifact } from "../lib/triage-parser";
import type { Verification } from "../lib/verification";
import type { SandboxResult } from "../worker/types";

export type BenchmarkSuite = "swt-bench" | "tdd-bench";
export type BenchmarkDifficulty = "easy" | "medium" | "hard";
export type BenchmarkFailureKind =
  | "assertion"
  | "exception"
  | "nonzero_exit"
  | "timeout";

export interface BenchmarkFixture {
  id: string;
  source: BenchmarkSuite;
  difficulty: BenchmarkDifficulty;
  repo: {
    owner: string;
    name: string;
    ref: string;
    sha: string;
    fixSha?: string;
    language?: string;
    runtimeHint?: string;
  };
  issue: {
    number: number;
    title: string;
    body: string;
    url: string;
    labels: string[];
    author?: string;
    createdAt?: string;
  };
  groundTruth: {
    classificationType: "bug";
    severity: string;
    reproExpected: boolean;
    failureSignal: {
      kind: BenchmarkFailureKind;
      matchAny: string[];
    };
    knownTestPath?: string;
    knownFailingTests?: string[];
  };
}

export interface BenchmarkTriageResult {
  artifact: TriageArtifact;
  classificationType: string;
  reproEligible: boolean;
}

export interface BenchmarkReproductionResult {
  succeeded: boolean;
  artifact?: ReproArtifactToolOutput;
  iterations: number;
  envSetupFailed: boolean;
  planArtifact?: ReproPlan;
  runArtifact?: ReproRun;
  lastSandboxResult?: SandboxResult;
}

export interface BenchmarkVerificationResult {
  artifact: Verification;
  verdict: Verification["verdict"];
  rerunResults: SandboxResult[];
}

export interface BenchmarkResult {
  fixtureId: string;
  source: BenchmarkSuite;
  difficulty: BenchmarkDifficulty;
  passed: boolean;
  triageCorrect: boolean;
  reproSucceeded: boolean;
  verificationVerdict: Verification["verdict"] | null;
  failToPass: boolean | null;
  iterations: number;
  envSetupFailed: boolean;
  totalTimeMs: number;
  error: string | null;
}

export interface BenchmarkMetrics {
  total: number;
  triageAccuracy: number;
  reproSuccessRate: number;
  envFailureRate: number;
  verificationPassRate: number;
  failToPassRate: number;
  avgIterations: number;
  avgTotalTimeSeconds: number;
  byDifficulty: Record<BenchmarkDifficulty, { total: number; passed: number }>;
}

export interface BenchmarkRegressionBaseline
  extends BenchmarkMetrics {
  date?: string;
  notes?: string;
}

export interface BenchmarkPipeline {
  runTriage(fixture: BenchmarkFixture): Promise<BenchmarkTriageResult>;
  runReproduction(
    fixture: BenchmarkFixture,
    triage: BenchmarkTriageResult,
    timeoutSeconds: number,
  ): Promise<BenchmarkReproductionResult>;
  runVerification(
    fixture: BenchmarkFixture,
    triage: BenchmarkTriageResult,
    reproduction: BenchmarkReproductionResult,
    timeoutSeconds: number,
  ): Promise<BenchmarkVerificationResult>;
  checkFailToPass(
    fixture: BenchmarkFixture,
    reproduction: BenchmarkReproductionResult,
    timeoutSeconds: number,
  ): Promise<boolean | null>;
}

export interface BenchmarkRunOptions {
  suite: BenchmarkSuite | "all";
  maxConcurrent: number;
  timeout: number;
  outputDir: string;
}

export interface BenchmarkSummaryFile extends BenchmarkMetrics {
  generatedAt: string;
  suite: BenchmarkSuite | "all";
}
