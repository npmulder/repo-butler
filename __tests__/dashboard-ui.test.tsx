import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { DashboardFilters } from "../components/DashboardFilters";
import { IssueFeed } from "../components/IssueFeed";
import { api } from "../convex/_generated/api";
import type { Doc } from "../convex/_generated/dataModel";
import { ApprovalActions } from "../components/ApprovalActions";
import { ConfidenceMeter } from "../components/ConfidenceMeter";
import { StatusBadge } from "../components/StatusBadge";
import { TriageCard } from "../components/TriageCard";
import { formatTimestamp } from "../lib/formatting";

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
    snapshottedAt: Date.UTC(2026, 2, 28, 21, 45, 0),
    state: "open",
    title: "Parser crash on empty YAML",
    ...overrides,
  } as Doc<"issues">;
}

function buildRepo(
  overrides: Partial<Doc<"repos">> = {},
): Doc<"repos"> {
  return {
    _creationTime: 0,
    _id: "repo_1" as Doc<"repos">["_id"],
    createdAt: 0,
    defaultBranch: "main",
    fullName: "acme/repo",
    installationId: "inst_1",
    isActive: true,
    name: "repo",
    owner: "acme",
    updatedAt: 0,
    userId: "user_1" as Doc<"repos">["userId"],
    ...overrides,
  } as Doc<"repos">;
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
  afterEach(() => {
    cleanup();
  });

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
      ["approved", "Approved"],
      ["needs_info", "Needs info"],
      ["rejected", "Rejected"],
      ["reproducing", "Reproducing"],
      ["verifying", "Verifying"],
      ["reporting", "Reporting"],
      ["completed", "Completed"],
      ["report_failed", "Report failed"],
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

  it("formats a zero timestamp instead of treating it as unavailable", () => {
    expect(formatTimestamp(0)).toContain("1970");
  });

  it("sends approval actions through the approval mutation", async () => {
    const mutate = vi.fn().mockResolvedValue(undefined);

    mockedUseMutation.mockReturnValue(mutate as never);

    render(<ApprovalActions runId={"run_1" as Doc<"runs">["_id"]} />);

    const approveButton = screen.getByRole("button", { name: /Approve/i });
    const requestInfoButton = screen.getByRole("button", {
      name: /Request info/i,
    });
    const rejectButton = screen.getByRole("button", { name: /Reject/i });

    fireEvent.click(approveButton);
    await waitFor(() =>
      expect(mutate).toHaveBeenNthCalledWith(1, {
        action: "approve",
        runId: "run_1",
      }),
    );
    await waitFor(() => expect(approveButton).not.toBeDisabled());

    fireEvent.click(requestInfoButton);
    await waitFor(() =>
      expect(mutate).toHaveBeenNthCalledWith(2, {
        action: "request_info",
        runId: "run_1",
      }),
    );
    await waitFor(() => expect(requestInfoButton).not.toBeDisabled());

    fireEvent.click(rejectButton);
    await waitFor(() =>
      expect(mutate).toHaveBeenNthCalledWith(3, {
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

  it("links triage cards to the run detail page with a preserved dashboard back link", () => {
    mockedUseSearchParams.mockReturnValue(
      new URLSearchParams("status=reproducing&q=parser") as never,
    );

    render(
      <TriageCard
        issue={buildIssue()}
        repo={{ fullName: "acme/repo", name: "repo", owner: "acme" }}
        run={buildRun({ status: "awaiting_approval" })}
        triage={buildTriage()}
      />,
    );

    expect(screen.getByRole("link", { name: "Run details" })).toHaveAttribute(
      "href",
      "/runs/run_1?back=%2Fdashboard%3Fstatus%3Dreproducing%26q%3Dparser",
    );
  });

  it("renders the dashboard page with mocked Convex data", () => {
    const user = buildUser();
    const repo = buildRepo();
    const run = buildRun({ status: "awaiting_approval" });
    const issue = buildIssue();
    const triage = buildTriage();

    mockedUseSearchParams.mockReturnValue(
      new URLSearchParams("q=parser") as never,
    );
    mockedUseQuery
      .mockReturnValueOnce(user as never)
      .mockReturnValueOnce([repo] as never)
      .mockReturnValueOnce(user as never)
      .mockReturnValueOnce([repo] as never)
      .mockReturnValueOnce(
        [
          {
            issue,
            repo: { fullName: repo.fullName, name: repo.name, owner: repo.owner },
            run,
            triage,
          },
        ] as never,
      )
      .mockReturnValueOnce(
        {
          activeSandbox: 0,
          awaitingApproval: 1,
          completed: 0,
          failed: 0,
          total24h: 1,
          triaged: 1,
        } as never,
      );

    render(<DashboardPage />);

    expect(screen.getByText("Issue triage queue")).toBeInTheDocument();
    expect(screen.getByDisplayValue("parser")).toBeInTheDocument();
    expect(screen.getByText("Parser crash on empty YAML")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open on GitHub/i })).toHaveAttribute(
      "href",
      "https://github.com/acme/repo/issues/42",
    );
  });

  it("keeps dashboard filters disabled while auth is still loading", () => {
    mockedUseQuery.mockImplementation(((reference: unknown) => {
      if (reference === api.users.getCurrentUser) {
        return undefined;
      }

      return undefined;
    }) as typeof useQuery);

    render(<DashboardFilters />);

    const searchInputs = screen.getAllByPlaceholderText("Search issue titles");

    expect(searchInputs.at(-1)).toBeDisabled();
    for (const input of screen.getAllByRole("combobox").slice(-3)) {
      expect(input).toBeDisabled();
    }
  });

  it("ignores an invalid repoId URL filter before subscribing to the feed", () => {
    const user = buildUser();
    const repo = buildRepo();
    const stats = {
      activeSandbox: 0,
      awaitingApproval: 0,
      completed: 0,
      failed: 0,
      total24h: 0,
      triaged: 0,
    };

    mockedUseSearchParams.mockReturnValue(
      new URLSearchParams("repoId=not-an-id") as never,
    );
    mockedUseQuery
      .mockReturnValueOnce(user as never)
      .mockReturnValueOnce([repo] as never)
      .mockReturnValueOnce([] as never)
      .mockReturnValueOnce(stats as never);

    render(<IssueFeed />);

    expect(mockedUseQuery.mock.calls[2]?.[1]).toEqual(
      expect.objectContaining({ limit: 50, repoId: undefined }),
    );
    expect(
      screen.getByText("No issues match the current filters"),
    ).toBeInTheDocument();
  });
});
