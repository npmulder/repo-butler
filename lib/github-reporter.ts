import { getInstallationOctokit } from "./githubApp";
import {
  formatTriageComment,
  formatVerificationComment,
} from "./comment-templates";
import { STATUS_LABELS, triageToLabels } from "./labels";
import type { TriageArtifact } from "./triage-parser";
import type { Verification } from "./verification";

export interface ReportInput {
  installationId: number;
  owner: string;
  repo: string;
  issueNumber: number;
  triage: TriageArtifact;
  verification?: Verification;
  reproArtifact?: { file_path: string; content: string };
  dashboardRunUrl: string;
}

const verificationStatusLabels: Record<Verification["verdict"], string> = {
  reproduced: STATUS_LABELS.reproVerified,
  not_reproduced: STATUS_LABELS.reproFailed,
  flaky: STATUS_LABELS.reproFailed,
  policy_violation: STATUS_LABELS.reproFailed,
  env_setup_failed: STATUS_LABELS.reproFailed,
  budget_exhausted: STATUS_LABELS.reproFailed,
};

function dedupeLabels(labels: string[]): string[] {
  return [...new Set(labels)];
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 404
  );
}

async function removeLabelIfPresent(
  input: Pick<ReportInput, "owner" | "repo" | "issueNumber"> & {
    installationId: number;
    name: string;
  },
): Promise<void> {
  const octokit = await getInstallationOctokit(input.installationId);

  try {
    await octokit.rest.issues.removeLabel({
      owner: input.owner,
      repo: input.repo,
      issue_number: input.issueNumber,
      name: input.name,
    });
  } catch (error) {
    if (isNotFoundError(error)) {
      return;
    }

    throw error;
  }
}

export async function postTriageReport(
  input: ReportInput,
): Promise<{ commentId: number; labelsApplied: string[] }> {
  const octokit = await getInstallationOctokit(input.installationId);
  const labels = dedupeLabels([
    ...triageToLabels(input.triage.classification),
    STATUS_LABELS.triaged,
    ...(input.triage.repro_eligible ? [STATUS_LABELS.needsRepro] : []),
  ]);
  const comment = await octokit.rest.issues.createComment({
    owner: input.owner,
    repo: input.repo,
    issue_number: input.issueNumber,
    body: formatTriageComment(input.triage, input.dashboardRunUrl),
  });

  if (labels.length > 0) {
    await octokit.rest.issues.addLabels({
      owner: input.owner,
      repo: input.repo,
      issue_number: input.issueNumber,
      labels,
    });
  }

  return {
    commentId: comment.data.id,
    labelsApplied: labels,
  };
}

export async function postVerificationReport(
  input: ReportInput,
): Promise<{ commentId: number; labelsApplied: string[] }> {
  if (!input.verification) {
    throw new Error("Verification report requires a verification artifact");
  }

  if (
    input.verification.verdict === "reproduced" &&
    (!input.reproArtifact?.file_path || !input.reproArtifact.content)
  ) {
    throw new Error(
      "Verification report for a reproduced verdict requires a reproduction artifact",
    );
  }

  const octokit = await getInstallationOctokit(input.installationId);
  const labelsToAdd = dedupeLabels([
    verificationStatusLabels[input.verification.verdict],
  ]);
  const comment = await octokit.rest.issues.createComment({
    owner: input.owner,
    repo: input.repo,
    issue_number: input.issueNumber,
    body: formatVerificationComment(
      input.triage,
      input.verification,
      input.reproArtifact,
      input.dashboardRunUrl,
    ),
  });

  for (const label of [
    STATUS_LABELS.needsRepro,
    STATUS_LABELS.reproRunning,
  ] as const) {
    await removeLabelIfPresent({
      installationId: input.installationId,
      owner: input.owner,
      repo: input.repo,
      issueNumber: input.issueNumber,
      name: label,
    });
  }

  await octokit.rest.issues.addLabels({
    owner: input.owner,
    repo: input.repo,
    issue_number: input.issueNumber,
    labels: labelsToAdd,
  });

  return {
    commentId: comment.data.id,
    labelsApplied: labelsToAdd,
  };
}
