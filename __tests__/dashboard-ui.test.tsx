import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("convex/react", () => ({
  useMutation: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}));

import { useMutation, useQuery } from "convex/react";
import {
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";

import DashboardPage from "../app/(dashboard)/dashboard/page";
import { api } from "../convex/_generated/api";
import type { Doc } from "../convex/_generated/dataModel";
import { ApprovalActions } from "../components/ApprovalActions";
import { ConfidenceMeter } from "../components/ConfidenceMeter";
import { StatusBadge } from "../components/StatusBadge";
import { TriageCard } from "../components/TriageCard";

const mockedUseMutation = vi.mocked(useMutation);
const mockedUsePathname = vi.mocked(usePathname);
const mockedUseQuery = vi.mocked(useQuery);
const mockedUseRouter = vi.mocked(useRouter);
const mockedUseSearchParams = vi.mocked(useSearchParams);

function buildUser(): Doc<"users"> {
  return {
    _creationTime: 0,
    _id: "user_1" as Doc<"users">["_id"],
    createdAt: 0,
    email: "operator@example.com",
    updatedAt: 0,
    workosId: "workos_1",
  };
}

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

function buildTriage(
  overrides: Partial<Doc<"triageResults">> = {},
): Doc<"triageResults"> {
  return {
    _creationTime: 0,
    _id: "triage_1" as Doc<"triageResults">["_id"],
    classification: {
      area: ["parser"],
      confidence: 0.92,
      labelsSuggested: ["type:bug", "area:parser"],
      severity: "high",
      type: "bug",
    },
    classificationType: "bug",
    confidence: 0.92,
    createdAt: Date.UTC(2026, 2, 28, 22, 1, 0),
    issueId: "issue_1" as Doc<"triageResults">["issueId"],
    repoId: "repo_1" as Doc<"triageResults">["repoId"],
    reproEligible: true,
    reproHypothesis: {
      environmentAssumptions: { os: "Ubuntu", runtime: "Node 20" },
      expectedFailureSignal: {
        kind: "exception",
        matchAny: ["ParseError"],
      },
      minimalStepsGuess: ["Create an empty YAML file.", "Run the parser."],
    },
    runId: "run_1" as Doc<"triageResults">["runId"],
    severity: "high",
    summary:
      "This is a high-confidence parser crash with explicit steps and a clear failure signal.",
    ...overrides,
  } as Doc<"triageResults">;
}

describe("dashboard UI", () => {
  beforeEach(() => {
    mockedUseMutation.mockReset();
    mockedUsePathname.mockReset();
    mockedUseQuery.mockReset();
    mockedUseRouter.mockReset();
    mockedUseSearchParams.mockReset();

    mockedUsePathname.mockReturnValue("/dashboard");
    mockedUseRouter.mockReturnValue({ replace: vi.fn() } as never);
    mockedUseSearchParams.mockReturnValue(new URLSearchParams("") as never);
    mockedUseMutation.mockReturnValue(vi.fn().mockResolvedValue(undefined) as never);
  });

  it("maps every run status to a readable badge", () => {
    const statusCases: Array<[Doc<"runs">["status"], string]> = [
      ["pending", "Pending"],
      ["triaging", "Triaging"],
      ["awaiting_approval", "Awaiting approval"],
      ["reproducing", "Reproducing"],
      ["verifying", "Verifying"],
      ["completed", "Completed"],
      ["failed", "Failed"],
      ["cancelled", "Cancelled"],
    ];

    const { rerender } = render(<StatusBadge status="pending" />);

    for (const [status, label] of statusCases) {
      rerender(<StatusBadge status={status} />);
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("renders confidence with proportional width and tiered colors", () => {
    const { rerender } = render(<ConfidenceMeter confidence={0.25} />);

    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByTestId("confidence-fill")).toHaveStyle({ width: "25%" });
    expect(screen.getByTestId("confidence-fill").className).toContain("from-rose-500");

    rerender(<ConfidenceMeter confidence={0.84} />);

    expect(screen.getByText("84%")).toBeInTheDocument();
    expect(screen.getByTestId("confidence-fill")).toHaveStyle({ width: "84%" });
    expect(screen.getByTestId("confidence-fill").className).toContain(
      "from-emerald-500",
    );
  });

  it("sends approval actions through the approval mutation", async () => {
    const mutate = vi.fn().mockResolvedValue(undefined);

    mockedUseMutation.mockReturnValue(mutate as never);

    render(<ApprovalActions runId={"run_1" as Doc<"runs">["_id"]} />);

    fireEvent.click(screen.getByRole("button", { name: /Approve/i }));
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith({
        action: "approve",
        runId: "run_1",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /Request info/i }));
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith({
        action: "request_info",
        runId: "run_1",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /Reject/i }));
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith({
        action: "reject",
        runId: "run_1",
      }),
    );
  });

  it("renders a triage card with badges, confidence, and summary", () => {
    render(
      <TriageCard
        issue={buildIssue()}
        repo={{ fullName: "acme/repo", name: "repo", owner: "acme" }}
        run={buildRun({ status: "awaiting_approval" })}
        triage={buildTriage()}
      />,
    );

    expect(screen.getByText("Parser crash on empty YAML")).toBeInTheDocument();
    expect(screen.getByText("bug")).toBeInTheDocument();
    expect(screen.getByText("high")).toBeInTheDocument();
    expect(screen.getByText("92%")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This is a high-confidence parser crash with explicit steps and a clear failure signal.",
      ),
    ).toBeInTheDocument();
  });

  it("renders the dashboard page with mocked Convex data", () => {
    const user = buildUser();
    const repo = {
      _creationTime: 0,
      _id: "repo_1",
      createdAt: 0,
      defaultBranch: "main",
      fullName: "acme/repo",
      installationId: "inst_1",
      isActive: true,
      name: "repo",
      owner: "acme",
      updatedAt: 0,
      userId: "user_1",
    };
    const run = buildRun({ status: "awaiting_approval" });
    const issue = buildIssue();
    const triage = buildTriage();

    mockedUseSearchParams.mockReturnValue(
      new URLSearchParams("q=parser") as never,
    );
    mockedUseQuery.mockImplementation(((reference: unknown) => {
      if (reference === api.users.getCurrentUser) {
        return user;
      }

      if (reference === api.dashboard.getRepoList) {
        return [repo];
      }

      if (reference === api.dashboard.getIssueFeed) {
        return [
          {
            issue,
            repo: { fullName: repo.fullName, name: repo.name, owner: repo.owner },
            run,
            triage,
          },
        ];
      }

      if (reference === api.dashboard.getDashboardStats) {
        return {
          activeSandbox: 0,
          awaitingApproval: 1,
          completed: 0,
          failed: 0,
          total24h: 1,
          triaged: 1,
        };
      }

      return undefined;
    }) as typeof useQuery);

    render(<DashboardPage />);

    expect(screen.getByText("Issue triage queue")).toBeInTheDocument();
    expect(screen.getByDisplayValue("parser")).toBeInTheDocument();
    expect(screen.getByText("Parser crash on empty YAML")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open on GitHub/i })).toHaveAttribute(
      "href",
      "https://github.com/acme/repo/issues/42",
    );
  });
});
