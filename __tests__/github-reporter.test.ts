import { beforeEach, describe, expect, it, vi } from "vitest";

import { sampleTriageArtifacts } from "./fixtures/sample-triage";
import {
  formatTriageComment,
  formatVerificationComment,
} from "../lib/comment-templates";
import {
  postTriageReport,
  postVerificationReport,
} from "../lib/github-reporter";
import { STATUS_LABELS } from "../lib/labels";
import type { Verification } from "../lib/verification";

const githubState = vi.hoisted(() => ({
  addLabels: vi.fn(),
  createComment: vi.fn(),
  getInstallationOctokit: vi.fn(),
  removeLabel: vi.fn(),
}));

vi.mock("../lib/githubApp", () => ({
  getInstallationOctokit: githubState.getInstallationOctokit,
}));

const dashboardUrl = "https://repo-butler.example/runs/run_pipeline";
const reproArtifact = {
  file_path: "tests/repro-issue-42.test.ts",
  content: [
    'import { describe, expect, it } from "vitest";',
    "",
    'describe("repro", () => {',
    '  it("fails", () => {',
    '    throw new Error("ParseError: unexpected end of input");',
    "  });",
    "});",
  ].join("\n"),
};

function buildVerification(
  overrides: Partial<Verification> = {},
): Verification {
  return {
    schema_version: "rb.verification.v1",
    run_id: "run_pipeline",
    verdict: "reproduced",
    determinism: {
      reruns: 3,
      fails: 3,
      flake_rate: 0,
    },
    policy_checks: {
      network_used: false,
      secrets_accessed: false,
      writes_outside_workspace: false,
      ran_as_root: false,
    },
    evidence: {
      failing_cmd: "pnpm test -- tests/repro-issue-42.test.ts",
      exit_code: 1,
      stderr_sha256: "b".repeat(64),
    },
    notes: "Observed the expected failure in every rerun.",
    ...overrides,
  };
}

beforeEach(() => {
  const octokit = {
    rest: {
      issues: {
        addLabels: githubState.addLabels,
        createComment: githubState.createComment,
        removeLabel: githubState.removeLabel,
      },
    },
  };

  githubState.addLabels.mockReset();
  githubState.addLabels.mockResolvedValue({ data: [] });
  githubState.createComment.mockReset();
  githubState.createComment.mockResolvedValue({ data: { id: 12345 } });
  githubState.getInstallationOctokit.mockReset();
  githubState.getInstallationOctokit.mockResolvedValue(octokit);
  githubState.removeLabel.mockReset();
  githubState.removeLabel.mockResolvedValue({ data: {} });
});

describe("comment templates", () => {
  it("formats a triage comment with classification, summary, hypothesis, and dashboard URL", () => {
    const comment = formatTriageComment(
      sampleTriageArtifacts.typescriptVitestBug,
      dashboardUrl,
    );

    expect(comment).toContain("## 🤖 Repo Butler — Triage Summary");
    expect(comment).toContain("`bug`");
    expect(comment).toContain("`high`");
    expect(comment).toContain("94%");
    expect(comment).toContain(
      sampleTriageArtifacts.typescriptVitestBug.summary,
    );
    expect(comment).toContain("Reproduction Hypothesis");
    expect(comment).toContain("ParseError");
    expect(comment).toContain(dashboardUrl);
  });

  it("formats a reproduced verification comment with artifact, evidence, and dashboard URL", () => {
    const comment = formatVerificationComment(
      sampleTriageArtifacts.typescriptVitestBug,
      buildVerification(),
      reproArtifact,
      dashboardUrl,
    );

    expect(comment).toContain("## ✅ Repo Butler — Reproduction Verified");
    expect(comment).toContain("0.0%");
    expect(comment).toContain("Reproduction Test");
    expect(comment).toContain(reproArtifact.file_path);
    expect(comment).toContain(reproArtifact.content);
    expect(comment).toContain("Failure Evidence");
    expect(comment).toContain("stderr hash");
    expect(comment).toContain(dashboardUrl);
  });

  it("formats a not reproduced verification comment without the reproduction artifact block", () => {
    const comment = formatVerificationComment(
      sampleTriageArtifacts.typescriptVitestBug,
      buildVerification({
        verdict: "not_reproduced",
        determinism: {
          reruns: 3,
          fails: 0,
          flake_rate: 1,
        },
        evidence: {
          failing_cmd: "pnpm test -- tests/repro-issue-42.test.ts",
          exit_code: 0,
        },
        notes: "No rerun reproduced the expected failure.",
      }),
      undefined,
      dashboardUrl,
    );

    expect(comment).toContain("## ❌ Repo Butler — Could Not Reproduce");
    expect(comment).not.toContain("Reproduction Test");
  });

  it("formats a flaky verification comment with the flake rate", () => {
    const comment = formatVerificationComment(
      sampleTriageArtifacts.typescriptVitestBug,
      buildVerification({
        verdict: "flaky",
        determinism: {
          reruns: 3,
          fails: 2,
          flake_rate: 1 / 3,
        },
        notes: "Observed a flaky failure rate above the allowed threshold.",
      }),
      undefined,
      dashboardUrl,
    );

    expect(comment).toContain("## ⚠️ Repo Butler — Flaky Reproduction");
    expect(comment).toContain("33.3%");
  });

  it("formats a policy violation verification comment with policy details", () => {
    const comment = formatVerificationComment(
      sampleTriageArtifacts.typescriptVitestBug,
      buildVerification({
        verdict: "policy_violation",
        policy_checks: {
          network_used: true,
          secrets_accessed: false,
          writes_outside_workspace: false,
          ran_as_root: false,
        },
        notes: "Network was enabled during verification.",
      }),
      undefined,
      dashboardUrl,
    );

    expect(comment).toContain("## 🛑 Repo Butler — Policy Violation");
    expect(comment).toContain("Policy Checks");
    expect(comment).toContain("- **Network used:** Yes");
  });
});

describe("GitHub reporter", () => {
  it("posts triage comments and applies triage labels", async () => {
    const result = await postTriageReport({
      installationId: 1001,
      owner: "repo-butler",
      repo: "example",
      issueNumber: 42,
      triage: sampleTriageArtifacts.typescriptVitestBug,
      dashboardRunUrl: dashboardUrl,
    });

    expect(githubState.createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("Triage Summary"),
        issue_number: 42,
        owner: "repo-butler",
        repo: "example",
      }),
    );
    expect(githubState.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: expect.arrayContaining([
          "type:bug",
          "area:parser",
          "severity:high",
          STATUS_LABELS.triaged,
          STATUS_LABELS.needsRepro,
        ]),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        commentId: 12345,
        labelsApplied: expect.arrayContaining([
          STATUS_LABELS.triaged,
          STATUS_LABELS.needsRepro,
        ]),
      }),
    );
  });

  it("posts reproduced verification comments, removes stale labels, and applies the verified label", async () => {
    const result = await postVerificationReport({
      installationId: 1001,
      owner: "repo-butler",
      repo: "example",
      issueNumber: 42,
      triage: sampleTriageArtifacts.typescriptVitestBug,
      verification: buildVerification(),
      reproArtifact,
      dashboardRunUrl: dashboardUrl,
    });

    expect(githubState.createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("Reproduction Verified"),
      }),
    );
    expect(githubState.removeLabel).toHaveBeenCalledWith(
      expect.objectContaining({ name: STATUS_LABELS.needsRepro }),
    );
    expect(githubState.removeLabel).toHaveBeenCalledWith(
      expect.objectContaining({ name: STATUS_LABELS.reproRunning }),
    );
    expect(githubState.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: [STATUS_LABELS.reproVerified],
      }),
    );
    expect(result).toEqual({
      commentId: 12345,
      labelsApplied: [STATUS_LABELS.reproVerified],
    });
  });

  it("maps failed verification verdicts to the repro failed label", async () => {
    await postVerificationReport({
      installationId: 1001,
      owner: "repo-butler",
      repo: "example",
      issueNumber: 42,
      triage: sampleTriageArtifacts.typescriptVitestBug,
      verification: buildVerification({
        verdict: "not_reproduced",
        determinism: {
          reruns: 3,
          fails: 0,
          flake_rate: 1,
        },
        evidence: {
          failing_cmd: "pnpm test -- tests/repro-issue-42.test.ts",
          exit_code: 0,
        },
      }),
      dashboardRunUrl: dashboardUrl,
    });

    expect(githubState.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: [STATUS_LABELS.reproFailed],
      }),
    );
  });
});
