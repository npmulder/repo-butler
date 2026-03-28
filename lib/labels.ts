import type { Octokit } from "octokit";

export const TYPE_LABELS = {
  bug: "type:bug",
  feature: "type:feature",
  docs: "type:docs",
  question: "type:question",
  build: "type:build",
  test: "type:test",
} as const;

export const STATUS_LABELS = {
  needsTriage: "rb:needs-triage",
  triaged: "rb:triaged",
  needsRepro: "rb:needs-repro",
  reproApproved: "rb:repro-approved",
  reproRunning: "rb:repro-running",
  reproVerified: "rb:repro-verified",
  reproFailed: "rb:repro-failed",
  needsInfo: "rb:needs-info",
} as const;

export const SEVERITY_LABELS = {
  low: "severity:low",
  medium: "severity:medium",
  high: "severity:high",
  critical: "severity:critical",
} as const;

export const AREA_LABEL_PREFIX = "area:";

export const ALL_RB_LABELS = [
  ...Object.values(TYPE_LABELS),
  ...Object.values(STATUS_LABELS),
  ...Object.values(SEVERITY_LABELS),
] as const;

export const LABEL_COLORS: Record<string, string> = {
  "type:bug": "d73a4a",
  "type:feature": "a2eeef",
  "type:docs": "0075ca",
  "type:question": "d876e3",
  "type:build": "f9d0c4",
  "type:test": "bfdadc",
  "rb:needs-triage": "fbca04",
  "rb:triaged": "0e8a16",
  "rb:needs-repro": "e4e669",
  "rb:repro-approved": "0e8a16",
  "rb:repro-running": "1d76db",
  "rb:repro-verified": "0e8a16",
  "rb:repro-failed": "d73a4a",
  "rb:needs-info": "fbca04",
  "severity:low": "c5def5",
  "severity:medium": "fbca04",
  "severity:high": "d93f0b",
  "severity:critical": "b60205",
};

type TriageClassification = {
  type: string;
  severity?: string;
  area?: string[];
  labels_suggested?: string[];
  labelsSuggested?: string[];
};

function dedupeLabels(labels: string[]) {
  return [...new Set(labels)];
}

function normalizeAreaLabel(area: string) {
  const trimmed = area.trim();

  if (!trimmed) {
    return null;
  }

  return trimmed.startsWith(AREA_LABEL_PREFIX)
    ? trimmed
    : `${AREA_LABEL_PREFIX}${trimmed}`;
}

export function triageToLabels(classification: TriageClassification): string[] {
  const labels: string[] = [];
  const typeLabel =
    TYPE_LABELS[classification.type as keyof typeof TYPE_LABELS];

  if (typeLabel) {
    labels.push(typeLabel);
  }

  if (classification.severity) {
    const severityLabel =
      SEVERITY_LABELS[
        classification.severity as keyof typeof SEVERITY_LABELS
      ];

    if (severityLabel) {
      labels.push(severityLabel);
    }
  }

  if (classification.area) {
    for (const area of classification.area) {
      const normalizedAreaLabel = normalizeAreaLabel(area);

      if (normalizedAreaLabel) {
        labels.push(normalizedAreaLabel);
      }
    }
  }

  labels.push(
    ...(classification.labels_suggested ?? classification.labelsSuggested ?? []),
  );

  return dedupeLabels(labels);
}

export async function syncLabelsToRepo(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<void> {
  const existingNames = new Set<string>();

  for (let page = 1; ; page += 1) {
    const { data } = await octokit.rest.issues.listLabelsForRepo({
      owner,
      repo,
      page,
      per_page: 100,
    });

    for (const label of data) {
      existingNames.add(label.name);
    }

    if (data.length < 100) {
      break;
    }
  }

  for (const label of ALL_RB_LABELS) {
    if (existingNames.has(label)) {
      continue;
    }

    await octokit.rest.issues.createLabel({
      owner,
      repo,
      name: label,
      color: LABEL_COLORS[label] ?? "ededed",
      description: `Repo Butler: ${label}`,
    });
  }
}
