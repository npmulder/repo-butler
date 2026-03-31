export type IssueSnapshotTimestamps = {
  createdAt: number;
  snapshottedAt: number;
};

export function getIssueSnapshottedAt(
  issue: IssueSnapshotTimestamps,
): number {
  return issue.snapshottedAt;
}
