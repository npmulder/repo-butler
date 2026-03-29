import { describe, expect, it } from "vitest";

import {
  approvalActionFromComment,
  approvalActionFromLabel,
  approvalPolicies,
  buildApprovalPatch,
  evaluateApprovalGate,
  isMaintainerCommentAuthorAssociation,
} from "../convex/approvalGate";
import { normalizeAreaLabel } from "../lib/areaLabels";
import { STATUS_LABELS } from "../lib/labels";

describe("approval gate", () => {
  it("auto-approves high-confidence triage when policy is auto_approve", () => {
    expect(
      evaluateApprovalGate({
        settings: {
          approvalPolicy: approvalPolicies.autoApprove,
          autoApproveThreshold: 0.7,
          maxConcurrentRuns: 3,
          maxDailyRuns: 20,
        },
        triageConfidence: 0.85,
        reproEligible: true,
        activeRuns: 0,
        dailyRuns: 0,
      }),
    ).toEqual({
      approved: true,
      reason: "Auto-approved (high confidence)",
    });
  });

  it("does not auto-approve when confidence falls below the configured threshold", () => {
    expect(
      evaluateApprovalGate({
        settings: {
          approvalPolicy: approvalPolicies.autoApprove,
          autoApproveThreshold: 0.7,
          maxConcurrentRuns: 3,
          maxDailyRuns: 20,
        },
        triageConfidence: 0.5,
        reproEligible: true,
        activeRuns: 0,
        dailyRuns: 0,
      }),
    ).toEqual({
      approved: false,
      reason: "Confidence below auto-approve threshold (0.70)",
    });
  });

  it("requires maintainer approval when the policy is require_label", () => {
    expect(
      evaluateApprovalGate({
        settings: {
          approvalPolicy: approvalPolicies.requireLabel,
          autoApproveThreshold: 0.7,
          maxConcurrentRuns: 3,
          maxDailyRuns: 20,
        },
        triageConfidence: 0.95,
        reproEligible: true,
        activeRuns: 0,
        dailyRuns: 0,
      }),
    ).toEqual({
      approved: false,
      reason: "Awaiting maintainer approval label",
    });
  });

  it("blocks approval when the concurrent run budget is exhausted", () => {
    expect(
      evaluateApprovalGate({
        settings: {
          approvalPolicy: approvalPolicies.autoApprove,
          autoApproveThreshold: 0.7,
          maxConcurrentRuns: 3,
          maxDailyRuns: 20,
        },
        triageConfidence: 0.95,
        reproEligible: true,
        activeRuns: 3,
        dailyRuns: 2,
      }),
    ).toEqual({
      approved: false,
      reason: "Max concurrent runs reached (3)",
    });
  });

  it("blocks approval when the daily run budget is exhausted", () => {
    expect(
      evaluateApprovalGate({
        settings: {
          approvalPolicy: approvalPolicies.autoApprove,
          autoApproveThreshold: 0.7,
          maxConcurrentRuns: 3,
          maxDailyRuns: 20,
        },
        triageConfidence: 0.95,
        reproEligible: true,
        activeRuns: 1,
        dailyRuns: 20,
      }),
    ).toEqual({
      approved: false,
      reason: "Daily run limit reached (20)",
    });
  });

  it("maps the repro-approved label to an approval action and run transition", () => {
    expect(approvalActionFromLabel(STATUS_LABELS.reproApproved)).toBe("approve");
    expect(
      buildApprovalPatch({
        action: "approve",
        approvedAt: 123,
        approvedBy: "maintainer",
        runStatus: "awaiting_approval",
      }),
    ).toEqual({
      success: true,
      patch: {
        status: "approved",
        approvedAt: 123,
        approvedBy: "maintainer",
        errorMessage: "Approved by maintainer",
      },
    });
  });

  it("defaults to maintainer label approval when repo settings are missing", () => {
    expect(
      evaluateApprovalGate({
        settings: null,
        triageConfidence: 0.95,
        reproEligible: true,
        activeRuns: 0,
        dailyRuns: 0,
      }),
    ).toEqual({
      approved: false,
      reason:
        "No repo settings configured; defaulting to maintainer label approval",
    });
  });

  it("parses maintainer approval comments", () => {
    expect(approvalActionFromComment("@repobutler approve")).toBe("approve");
    expect(approvalActionFromComment("@repobutler reject")).toBe("reject");
    expect(approvalActionFromComment("@repobutler request-info")).toBe(
      "request_info",
    );
  });

  it("only accepts maintainer-associated comment approvals", () => {
    expect(isMaintainerCommentAuthorAssociation("OWNER")).toBe(true);
    expect(isMaintainerCommentAuthorAssociation("member")).toBe(true);
    expect(isMaintainerCommentAuthorAssociation("CONTRIBUTOR")).toBe(false);
    expect(isMaintainerCommentAuthorAssociation(undefined)).toBe(false);
  });

  it("normalizes area labels consistently", () => {
    expect(normalizeAreaLabel(" area:Parser Errors ")).toBe("area:parser-errors");
    expect(normalizeAreaLabel("Parser Errors")).toBe("area:parser-errors");
  });
});
