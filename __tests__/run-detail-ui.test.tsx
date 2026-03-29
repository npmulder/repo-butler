import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: vi.fn(),
}));

import { useQuery } from "convex/react";
import { useSearchParams } from "next/navigation";

import { ArtifactViewer } from "../components/ArtifactViewer";
import { IterationHistory } from "../components/IterationHistory";
import { RunDetailClient } from "../components/RunDetailClient";
import { RunTimeline } from "../components/RunTimeline";
import { StepLogViewer } from "../components/StepLogViewer";
import type { Doc } from "../convex/_generated/dataModel";
import {
  buildRunTimelineStages,
  formatStepDuration,
  type ReproRunDetail,
  type RunDetailData,
  type VerificationDetail,
} from "../lib/run-detail";

const mockedUseQuery = vi.mocked(useQuery);
const mockedUseSearchParams = vi.mocked(useSearchParams);

function buildRun(
  overrides: Partial<Doc<"runs">> & Pick<Doc<"runs">, "status">,
): Doc<"runs"> {
  const { status, ...rest } = overrides;

  return {
    _creationTime: 0,
    _id: "run_1" as Doc<"runs">["_id"],
    issueId: "issue_1" as Doc<"runs">["issueId"],
    repoId: "repo_1" as Doc<"runs">["repoId"],
    runId: "run-1",
    startedAt: Date.UTC(2026, 2, 28, 22, 0, 0),
    status,
    triggeredBy: "issue_opened",
    userId: "user_1" as Doc<"runs">["userId"],
    ...rest,
  } as Doc<"runs">;
}

function buildIssue(overrides: Partial<Doc<"issues">> = {}): Doc<"issues"> {
  return {
    _creationTime: 0,
    _id: "issue_1" as Doc<"issues">["_id"],
    authorLogin: "octocat",
    createdAt: Date.UTC(2026, 2, 28, 21, 45, 0),
    githubCreatedAt: "2026-03-28T21:45:00.000Z",
    githubIssueNumber: BigInt(42),
    githubIssueUrl: "https://github.com/acme/repo/issues/42",
    labels: ["bug"],
    repoId: "repo_1" as Doc<"issues">["repoId"],
    snapshotedAt: Date.UTC(2026, 2, 28, 21, 45, 0),
    state: "open",
    title: "Parser crash on empty YAML",
    ...overrides,
  } as Doc<"issues">;
}

function buildRepo(overrides: Partial<Doc<"repos">> = {}): Doc<"repos"> {
  return {
    _creationTime: 0,
    _id: "repo_1" as Doc<"repos">["_id"],
    createdAt: 0,
    defaultBranch: "main",
    fullName: "acme/repo",
    installationId: "inst_1" as Doc<"repos">["installationId"],
    isActive: true,
    name: "repo",
    owner: "acme",
    updatedAt: 0,
    userId: "user_1" as Doc<"repos">["userId"],
    ...overrides,
  } as Doc<"repos">;
}

function buildRepoSettings(
  overrides: Partial<Doc<"repoSettings">> = {},
): Doc<"repoSettings"> {
  return {
    _creationTime: 0,
    _id: "repo_settings_1" as Doc<"repoSettings">["_id"],
    approvalMode: "label_required",
    createdAt: 0,
    dailyRunLimit: BigInt(20),
    maxConcurrentRuns: BigInt(3),
    networkEnabled: false,
    repoId: "repo_1" as Doc<"repoSettings">["repoId"],
    sandboxTimeoutSeconds: BigInt(1_200),
    updatedAt: 0,
    ...overrides,
  } as Doc<"repoSettings">;
}

function buildTriage(
  overrides: Partial<Doc<"triageResults">> = {},
): Doc<"triageResults"> {
  return {
    _creationTime: 0,
    _id: "triage_1" as Doc<"triageResults">["_id"],
    classificationType: "bug",
    confidence: 0.92,
    createdAt: Date.UTC(2026, 2, 28, 22, 1, 0),
    issueId: "issue_1" as Doc<"triageResults">["issueId"],
    repoId: "repo_1" as Doc<"triageResults">["repoId"],
    reproEligible: true,
    runId: "run_1" as Doc<"triageResults">["runId"],
    schemaVersion: "rb.triage.v1",
    summary: "Parser crash is reproducible with a short YAML input.",
    ...overrides,
  } as Doc<"triageResults">;
}

function buildReproContract(
  overrides: Partial<Doc<"reproContracts">> = {},
): Doc<"reproContracts"> {
  return {
    _creationTime: 0,
    _id: "contract_1" as Doc<"reproContracts">["_id"],
    acceptance: {
      artifactType: "test",
      failureSignal: { kind: "exception", matchAny: ["ParseError"] },
      mustBeDeterministic: { allowedFlakeRate: 0, reruns: BigInt(3) },
      mustFailOnBaseRevision: true,
      mustNotRequireNetwork: true,
    },
    budgets: { maxIterations: BigInt(6), wallClockSeconds: BigInt(1_200) },
    createdAt: Date.UTC(2026, 2, 28, 22, 2, 0),
    runId: "run_1" as Doc<"reproContracts">["runId"],
    sandboxPolicy: {
      network: "disabled",
      runAsRoot: false,
      secretsMount: "none",
    },
    schemaVersion: "rb.repro_contract.v1",
    ...overrides,
  } as Doc<"reproContracts">;
}

function buildReproPlan(
  overrides: Partial<Doc<"reproPlans">> = {},
): Doc<"reproPlans"> {
  return {
    _creationTime: 0,
    _id: "plan_1" as Doc<"reproPlans">["_id"],
    artifact: { path: "tests/test_repro_issue_42.py", type: "test" },
    baseRevision: { ref: "main", sha: "abc123" },
    commands: [{ cmd: "pytest tests/test_repro_issue_42.py", cwd: "/workspace" }],
    createdAt: Date.UTC(2026, 2, 28, 22, 3, 0),
    environmentStrategy: {
      detected: "dockerfile",
      fallbacks: ["bootstrap"],
      preferred: "dockerfile",
    },
    runId: "run_1" as Doc<"reproPlans">["runId"],
    schemaVersion: "rb.repro_plan.v1",
    ...overrides,
  } as Doc<"reproPlans">;
}

function buildReproRun(
  overrides: Partial<ReproRunDetail> = {},
): ReproRunDetail {
  return {
    _creationTime: Date.UTC(2026, 2, 28, 22, 4, 0),
    _id: "repro_run_1" as ReproRunDetail["_id"],
    artifactContent: "def test_repro_42():\n    raise ParseError()",
    durationMs: BigInt(23_400),
    environmentStrategy: { attempted: "dockerfile", detected: "dockerfile" },
    failureObserved: {
      kind: "exception",
      matchAny: ["ParseError: unexpected end of input"],
      traceExcerptSha256: "d".repeat(64),
    },
    iteration: BigInt(1),
    logStorageId: undefined,
    logUrl: null,
    runId: "run_1" as ReproRunDetail["runId"],
    sandbox: {
      imageDigest: "sha256:" + "a".repeat(64),
      kind: "docker",
      network: "disabled",
      uid: BigInt(1000),
    },
    schemaVersion: "rb.repro_run.v1",
    steps: [
      {
        cmd: "pytest tests/test_repro_issue_42.py",
        durationMs: BigInt(1_200),
        exitCode: BigInt(1),
        name: "run_test",
        stderrSha256: "b".repeat(64),
        stderrTail: "ParseError: unexpected end of input\n  at Parser.parse (src/parser.ts:45)",
        stdoutSha256: "c".repeat(64),
        stdoutTail: "collecting ...",
      },
    ],
    ...overrides,
  } as ReproRunDetail;
}

function buildVerification(
  overrides: Partial<VerificationDetail> = {},
): VerificationDetail {
  return {
    _creationTime: 0,
    _id: "verification_1" as VerificationDetail["_id"],
    createdAt: Date.UTC(2026, 2, 28, 22, 8, 0),
    determinism: { fails: BigInt(3), flakeRate: 0, reruns: BigInt(3) },
    evidence: {
      exitCode: BigInt(1),
      failingCmd: "pytest tests/test_repro_issue_42.py",
      stderrSha256: "e".repeat(64),
    },
    logStorageId: undefined,
    logUrl: null,
    policyChecks: {
      networkUsed: false,
      secretsAccessed: false,
      writesOutsideWorkspace: false,
    },
    runId: "run_1" as VerificationDetail["runId"],
    schemaVersion: "rb.verification.v1",
    verdict: "reproduced",
    ...overrides,
  } as VerificationDetail;
}

function buildRunDetail(overrides: Partial<RunDetailData> = {}): RunDetailData {
  const reproRuns = overrides.reproRuns ?? [buildReproRun()];

  return {
    issue: buildIssue(),
    latestReproRun: reproRuns.at(-1) ?? null,
    repo: buildRepo(),
    repoSettings: buildRepoSettings(),
    reproContract: buildReproContract(),
    reproPlan: buildReproPlan(),
    reproRuns,
    run: buildRun({
      approvalUpdatedAt: Date.UTC(2026, 2, 28, 22, 2, 30),
      startedAt: Date.UTC(2026, 2, 28, 22, 0, 0),
      status: "completed",
      verdict: "reproduced",
    }),
    triage: buildTriage(),
    verification: buildVerification(),
    ...overrides,
  };
}

describe("run detail UI", () => {
  beforeEach(() => {
    mockedUseQuery.mockReset();
    mockedUseSearchParams.mockReset();
    mockedUseSearchParams.mockReturnValue(
      new URLSearchParams("back=%2Fdashboard%3Fstatus%3Dreproducing") as never,
    );

    Object.assign(global.navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("derives timeline stages for active and failed pipeline states", () => {
    const activeStages = buildRunTimelineStages(
      buildRunDetail({
        latestReproRun: null,
        reproRuns: [],
        run: buildRun({ status: "awaiting_approval" }),
        verification: null,
      }),
      Date.UTC(2026, 2, 28, 22, 5, 0),
    );
    const failedStages = buildRunTimelineStages(
      buildRunDetail({
        run: buildRun({
          completedAt: Date.UTC(2026, 2, 28, 22, 7, 0),
          status: "failed",
          verdict: "budget_exhausted",
        }),
        verification: null,
      }),
      Date.UTC(2026, 2, 28, 22, 8, 0),
    );

    expect(activeStages.find((stage) => stage.key === "approval")?.status).toBe(
      "active",
    );
    expect(
      failedStages.find((stage) => stage.key === "reproduction")?.status,
    ).toBe("failed");
    expect(failedStages.find((stage) => stage.key === "report")?.status).toBe(
      "failed",
    );
  });

  it("rounds carried minute and hour durations without emitting 60-second labels", () => {
    expect(formatStepDuration(119_600)).toBe("2m");
    expect(formatStepDuration(3_599_600)).toBe("1h");
  });

  it("renders the timeline component with stage statuses", () => {
    render(<RunTimeline detail={buildRunDetail()} now={Date.UTC(2026, 2, 28, 22, 10, 0)} />);

    expect(screen.getByText("Pipeline timeline")).toBeInTheDocument();
    expect(screen.getByText("Reproduction")).toBeInTheDocument();
    expect(screen.getAllByText("completed").length).toBeGreaterThan(0);
  });

  it("expands step logs and shows persisted output excerpts", () => {
    render(<StepLogViewer reproRuns={[buildReproRun()]} />);

    fireEvent.click(screen.getByRole("button", { name: /Show output/i }));

    expect(screen.getByText(/ParseError: unexpected end of input/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/This run only persisted SHA-256 fingerprints/i),
    ).not.toBeInTheDocument();
    expect(screen.getByText("exit 1")).toBeInTheDocument();
  });

  it("renders artifact tabs and handles missing artifacts", () => {
    render(
      <ArtifactViewer
        detail={buildRunDetail({
          verification: null,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Expand JSON/i }));
    fireEvent.click(screen.getByRole("button", { name: "Verification" }));

    expect(screen.getByText("No verification artifact yet")).toBeInTheDocument();
    expect(screen.getByText("No artifact is stored for this stage yet.")).toBeInTheDocument();
  });

  it("renders iteration summaries from repro run history", () => {
    const firstRun = buildReproRun({
      _id: "repro_run_1" as ReproRunDetail["_id"],
      artifactContent: "print('attempt one')",
      iteration: BigInt(1),
      steps: [
        {
          cmd: "pytest tests/test_repro_issue_42.py",
          durationMs: BigInt(1_000),
          exitCode: BigInt(1),
          name: "run_test",
          stderrSha256: "1".repeat(64),
          stderrTail: "ModuleNotFoundError: parser",
          stdoutSha256: "2".repeat(64),
          stdoutTail: "",
        },
      ],
    });
    const secondRun = buildReproRun({
      _creationTime: Date.UTC(2026, 2, 28, 22, 6, 0),
      _id: "repro_run_2" as ReproRunDetail["_id"],
      artifactContent: "print('attempt two')",
      iteration: BigInt(2),
    });

    render(
      <IterationHistory
        detail={buildRunDetail({
          reproRuns: [firstRun, secondRun],
        })}
      />,
    );

    expect(screen.getByText("Iteration 1/2")).toBeInTheDocument();
    expect(screen.getByText(/ModuleNotFoundError: parser/)).toBeInTheDocument();
    expect(
      screen.getByText(/Updated the candidate reproduction artifact/i),
    ).toBeInTheDocument();
  });

  it("renders loading and populated run detail page states with mocked Convex data", () => {
    mockedUseQuery.mockReturnValueOnce(undefined as never);

    const { rerender } = render(<RunDetailClient runId={"run_1"} />);

    expect(screen.getByText("Loading pipeline data")).toBeInTheDocument();

    mockedUseQuery.mockReturnValue(buildRunDetail() as never);

    rerender(<RunDetailClient runId={"run_1"} />);

    expect(screen.getByText("Parser crash on empty YAML")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back/i })).toHaveAttribute(
      "href",
      "/dashboard?status=reproducing",
    );
    expect(screen.getByRole("link", { name: /Source issue/i })).toHaveAttribute(
      "href",
      "https://github.com/acme/repo/issues/42",
    );
  });
});
