export type IssueSnapshotTimestamps = {
  createdAt: number;
  snapshotedAt?: number;
  snapshottedAt?: number;
};

export function getIssueSnapshottedAt(
  issue: IssueSnapshotTimestamps,
): number {
  return issue.snapshottedAt ?? issue.snapshotedAt ?? issue.createdAt;
}

