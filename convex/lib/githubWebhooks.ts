export type GitHubWebhookCommand = "triage" | "reproduce" | "status";
export type WebhookRunTrigger =
  | "issue_opened"
  | "label_added"
  | "comment_command";
export type WebhookDispatch =
  | "issue_opened"
  | "repro_label"
  | "comment_command"
  | "status_command"
  | "installation_suspended"
  | "ignored";

export type WebhookRepo<RepoId, UserId> = {
  id: RepoId;
  userId: UserId;
  fullName: string;
};

export type IssueSnapshotInput<RepoId> = {
  repoId: RepoId;
  githubIssueNumber: bigint;
  githubIssueUrl: string;
  title: string;
  body?: string;
  authorLogin: string;
  labels: string[];
  state: "open" | "closed";
};

export type WebhookIssue<IssueId, RepoId> = {
  id: IssueId;
  repoId: RepoId;
  githubIssueNumber: bigint;
};

export type WebhookInstallation<InstallationId> = {
  id: InstallationId;
  installationId: bigint;
};

export type CreateRunInput<RepoId, IssueId, UserId> = {
  issueId: IssueId;
  repo: WebhookRepo<RepoId, UserId>;
  githubIssueNumber: bigint;
  triggeredBy: WebhookRunTrigger;
  startedAt: number;
};

export type ProcessWebhookInput = {
  deliveryId: string;
  event: string;
  action: string;
  payload: unknown;
};

export type ProcessWebhookResult = {
  duplicate: boolean;
  dispatch: WebhookDispatch;
};

export interface WebhookStore<
  RepoId,
  IssueId,
  RunId,
  InstallationId,
  UserId,
> {
  hasDelivery(deliveryId: string): Promise<boolean>;
  recordDelivery(input: {
    deliveryId: string;
    event: string;
    action: string;
    processedAt: number;
  }): Promise<void>;
  getActiveRepoByFullName(
    fullName: string,
  ): Promise<WebhookRepo<RepoId, UserId> | null>;
  createIssueSnapshot(
    input: IssueSnapshotInput<RepoId>,
  ): Promise<WebhookIssue<IssueId, RepoId>>;
  createRun(input: CreateRunInput<RepoId, IssueId, UserId>): Promise<RunId>;
  scheduleTriage(runId: RunId, issueId: IssueId): Promise<void>;
  getInstallationByInstallationId(
    installationId: bigint,
  ): Promise<WebhookInstallation<InstallationId> | null>;
  markInstallationSuspended(
    installationId: InstallationId,
    suspendedAt: number,
  ): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readRecord(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const nested = value[key];
  return isRecord(nested) ? nested : null;
}

function toBigInt(value: unknown) {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return BigInt(value);
  }

  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return BigInt(value);
  }

  return null;
}

function extractRepositoryFullName(payload: unknown) {
  if (!isRecord(payload)) {
    return null;
  }

  return readString(readRecord(payload, "repository")?.full_name);
}

function extractLabelName(payload: unknown) {
  if (!isRecord(payload)) {
    return null;
  }

  return readString(readRecord(payload, "label")?.name);
}

function extractCommentBody(payload: unknown) {
  if (!isRecord(payload)) {
    return null;
  }

  return readString(readRecord(payload, "comment")?.body);
}

function extractInstallationId(payload: unknown) {
  if (!isRecord(payload)) {
    return null;
  }

  return toBigInt(readRecord(payload, "installation")?.id);
}

function extractIssueSnapshotInput<RepoId>(
  repoId: RepoId,
  payload: unknown,
): IssueSnapshotInput<RepoId> | null {
  if (!isRecord(payload)) {
    return null;
  }

  const issue = readRecord(payload, "issue");

  if (!issue) {
    return null;
  }

  const githubIssueNumber = toBigInt(issue.number);
  const githubIssueUrl = readString(issue.html_url);
  const title = readString(issue.title);
  const authorLogin = readString(readRecord(issue, "user")?.login);
  const state = readString(issue.state);

  if (
    githubIssueNumber === null ||
    !githubIssueUrl ||
    !title ||
    !authorLogin ||
    (state !== "open" && state !== "closed")
  ) {
    return null;
  }

  const labels = Array.isArray(issue.labels)
    ? issue.labels
        .map((label) => {
          if (!isRecord(label)) {
            return null;
          }

          return readString(label.name);
        })
        .filter((label): label is string => label !== null)
    : [];

  const body = typeof issue.body === "string" ? issue.body : undefined;

  return {
    repoId,
    githubIssueNumber,
    githubIssueUrl,
    title,
    ...(body !== undefined ? { body } : {}),
    authorLogin,
    labels,
    state,
  };
}

export function parseBotCommand(
  commentBody: string,
): GitHubWebhookCommand | null {
  const match = commentBody.match(/\B@repobutler\s+(triage|reproduce|status)\b/i);
  return match ? (match[1].toLowerCase() as GitHubWebhookCommand) : null;
}

export async function verifyWebhookSignature(
  rawBody: Uint8Array,
  signature: string,
  secret: string,
) {
  if (!signature.startsWith("sha256=")) {
    return false;
  }

  const expected = signature.slice(7);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const payloadBytes = new Uint8Array(rawBody.byteLength);
  payloadBytes.set(rawBody);
  const digest = await crypto.subtle.sign("HMAC", key, payloadBytes);
  const computed = Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

  if (expected.length !== computed.length) {
    return false;
  }

  let result = 0;

  for (let index = 0; index < expected.length; index += 1) {
    result |= expected.charCodeAt(index) ^ computed.charCodeAt(index);
  }

  return result === 0;
}

async function createRunForIssue<RepoId, IssueId, RunId, InstallationId, UserId>(
  store: WebhookStore<RepoId, IssueId, RunId, InstallationId, UserId>,
  repo: WebhookRepo<RepoId, UserId>,
  issue: WebhookIssue<IssueId, RepoId>,
  triggeredBy: WebhookRunTrigger,
  startedAt: number,
) {
  const runId = await store.createRun({
    issueId: issue.id,
    repo,
    githubIssueNumber: issue.githubIssueNumber,
    triggeredBy,
    startedAt,
  });

  await store.scheduleTriage(runId, issue.id);
}

export async function processWebhookDelivery<
  RepoId,
  IssueId,
  RunId,
  InstallationId,
  UserId,
>(
  store: WebhookStore<RepoId, IssueId, RunId, InstallationId, UserId>,
  input: ProcessWebhookInput,
): Promise<ProcessWebhookResult> {
  if (await store.hasDelivery(input.deliveryId)) {
    return { duplicate: true, dispatch: "ignored" };
  }

  const processedAt = Date.now();
  let dispatch: WebhookDispatch = "ignored";

  if (input.event === "issues" && input.action === "opened") {
    const repoFullName = extractRepositoryFullName(input.payload);
    const repo = repoFullName
      ? await store.getActiveRepoByFullName(repoFullName)
      : null;
    const issueInput = repo
      ? extractIssueSnapshotInput(repo.id, input.payload)
      : null;

    if (repo && issueInput) {
      const issue = await store.createIssueSnapshot(issueInput);
      await createRunForIssue(
        store,
        repo,
        issue,
        "issue_opened",
        processedAt,
      );
      dispatch = "issue_opened";
    }
  } else if (input.event === "issues" && input.action === "labeled") {
    const repoFullName = extractRepositoryFullName(input.payload);
    const repo = repoFullName
      ? await store.getActiveRepoByFullName(repoFullName)
      : null;
    const issueInput = repo
      ? extractIssueSnapshotInput(repo.id, input.payload)
      : null;

    if (repo && issueInput && extractLabelName(input.payload) === "repro-me") {
      const issue = await store.createIssueSnapshot(issueInput);
      await createRunForIssue(store, repo, issue, "label_added", processedAt);
      dispatch = "repro_label";
    }
  } else if (
    input.event === "issue_comment" &&
    input.action === "created"
  ) {
    const commentBody = extractCommentBody(input.payload);
    const command = commentBody ? parseBotCommand(commentBody) : null;
    const repoFullName = extractRepositoryFullName(input.payload);
    const repo = repoFullName
      ? await store.getActiveRepoByFullName(repoFullName)
      : null;
    const issueInput = repo
      ? extractIssueSnapshotInput(repo.id, input.payload)
      : null;

    if (
      repo &&
      issueInput &&
      (command === "triage" || command === "reproduce")
    ) {
      const issue = await store.createIssueSnapshot(issueInput);
      await createRunForIssue(
        store,
        repo,
        issue,
        "comment_command",
        processedAt,
      );
      dispatch = "comment_command";
    } else if (repo && issueInput && command === "status") {
      dispatch = "status_command";
    }
  } else if (input.event === "installation") {
    const installationId = extractInstallationId(input.payload);
    const installation =
      installationId !== null
        ? await store.getInstallationByInstallationId(installationId)
        : null;

    if (
      installation &&
      (input.action === "deleted" || input.action === "suspend")
    ) {
      await store.markInstallationSuspended(installation.id, processedAt);
      dispatch = "installation_suspended";
    }
  }

  await store.recordDelivery({
    deliveryId: input.deliveryId,
    event: input.event,
    action: input.action,
    processedAt,
  });

  return {
    duplicate: false,
    dispatch,
  };
}
