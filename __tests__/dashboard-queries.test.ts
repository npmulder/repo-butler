import { describe, expect, it } from "vitest";

import type { Doc } from "../convex/_generated/dataModel";
import { filterDashboardFeed, summarizeDashboardStats } from "../convex/dashboard";

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
    startedAt: 0,
    status,
    triggeredBy: "issue_opened",
    ...rest,
  } as Doc<"runs">;
}

function buildTriage(
  overrides: Partial<Doc<"triageResults">>,
): Doc<"triageResults"> {
  return {
    _creationTime: 0,
    _id: "triage_1" as Doc<"triageResults">["_id"],
    createdAt: 0,
    repoId: "repo_1" as Doc<"triageResults">["repoId"],
    runId: "run_1" as Doc<"triageResults">["runId"],
    ...overrides,
  } as Doc<"triageResults">;
}

describe("dashboard query helpers", () => {
  it("filters the issue feed by run status and classification", () => {
    const bugItem = {
      issue: null,
      repo: { fullName: "acme/repo", name: "repo", owner: "acme" },
      run: buildRun({ status: "awaiting_approval" }),
      triage: buildTriage({ classificationType: "bug" }),
    };
    const docsItem = {
      issue: null,
      repo: { fullName: "acme/docs", name: "docs", owner: "acme" },
      run: buildRun({ _id: "run_2" as Doc<"runs">["_id"], status: "completed" }),
      triage: buildTriage({
        _id: "triage_2" as Doc<"triageResults">["_id"],
        classificationType: "docs",
        runId: "run_2" as Doc<"triageResults">["runId"],
      }),
    };

    expect(
      filterDashboardFeed([bugItem, docsItem], { status: "awaiting_approval" }),
    ).toEqual([bugItem]);
    expect(
      filterDashboardFeed([bugItem, docsItem], { classificationType: "docs" }),
    ).toEqual([docsItem]);
    expect(
      filterDashboardFeed([bugItem, docsItem], {
        classificationType: "bug",
        status: "awaiting_approval",
      }),
    ).toEqual([bugItem]);
  });

  it("summarizes dashboard stats across the current run model", () => {
    const stats = summarizeDashboardStats([
      { status: "pending" },
      { status: "triaging" },
      { status: "awaiting_approval" },
      { status: "reproducing" },
      { status: "verifying" },
      { status: "completed" },
      { status: "failed" },
      { status: "cancelled" },
    ] as Array<Pick<Doc<"runs">, "status">>);

    expect(stats).toEqual({
      activeSandbox: 2,
      awaitingApproval: 1,
      completed: 1,
      failed: 2,
      total24h: 8,
      triaged: 6,
    });
  });
});
