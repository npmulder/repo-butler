import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const classificationValidator = v.object({
  type: v.union(
    v.literal("bug"),
    v.literal("docs"),
    v.literal("question"),
    v.literal("feature"),
    v.literal("build"),
    v.literal("test"),
  ),
  area: v.optional(v.array(v.string())),
  severity: v.optional(
    v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("critical"),
    ),
  ),
  labelsSuggested: v.array(v.string()),
  confidence: v.float64(),
});

const failureSignalValidator = v.object({
  kind: v.union(
    v.literal("exception"),
    v.literal("assertion"),
    v.literal("nonzero_exit"),
    v.literal("snapshot_diff"),
    v.literal("timeout"),
  ),
  matchAny: v.optional(v.array(v.string())),
});

const reproHypothesisValidator = v.object({
  minimalStepsGuess: v.optional(v.array(v.string())),
  expectedFailureSignal: failureSignalValidator,
  environmentAssumptions: v.optional(v.any()),
});

const sandboxPolicyValidator = v.object({
  network: v.union(v.literal("disabled"), v.literal("enabled")),
  runAsRoot: v.boolean(),
  secretsMount: v.union(v.literal("none"), v.literal("readonly")),
});

const stepResultValidator = v.object({
  name: v.string(),
  cmd: v.string(),
  exitCode: v.int64(),
  stdoutSha256: v.optional(v.string()),
  stderrSha256: v.optional(v.string()),
  stdoutTail: v.optional(v.string()),
  stderrTail: v.optional(v.string()),
  durationMs: v.optional(v.int64()),
});

const verdictValidator = v.union(
  v.literal("reproduced"),
  v.literal("not_reproduced"),
  v.literal("flaky"),
  v.literal("policy_violation"),
  v.literal("env_setup_failed"),
  v.literal("budget_exhausted"),
);

const environmentStrategyNameValidator = v.union(
  v.literal("devcontainer"),
  v.literal("dockerfile"),
  v.literal("synth_dockerfile"),
  v.literal("bootstrap"),
);

// Accept legacy values during the schema transition so existing stored artifacts remain valid.
const storedEnvironmentStrategyNameValidator = v.union(
  environmentStrategyNameValidator,
  v.literal("repo2run_synth"),
  v.literal("manual_bootstrap"),
);

const reproPlanEnvironmentStrategyValidator = v.object({
  preferred: storedEnvironmentStrategyNameValidator,
  detected: v.optional(storedEnvironmentStrategyNameValidator),
  fallbacks: v.array(storedEnvironmentStrategyNameValidator),
  notes: v.optional(v.string()),
  imageUsed: v.optional(v.string()),
});

const reproRunFailureTypeValidator = v.union(
  v.literal("env_setup"),
  v.literal("repro_failure"),
);

const reproRunEnvironmentStrategyValidator = v.object({
  attempted: environmentStrategyNameValidator,
  detected: v.optional(environmentStrategyNameValidator),
  failedAt: v.optional(v.string()),
  notes: v.optional(v.string()),
  imageUsed: v.optional(v.string()),
});

export default defineSchema({
  users: defineTable({
    workosId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    createdAt: v.float64(),
    updatedAt: v.float64(),
  })
    .index("by_workos_id", ["workosId"])
    .index("by_email", ["email"]),

  githubInstallations: defineTable({
    userId: v.id("users"),
    installationId: v.int64(),
    accountLogin: v.string(),
    accountType: v.union(v.literal("Organization"), v.literal("User")),
    permissions: v.any(),
    createdAt: v.float64(),
    suspendedAt: v.optional(v.float64()),
  })
    .index("by_user", ["userId"])
    .index("by_installation_id", ["installationId"]),

  repos: defineTable({
    userId: v.id("users"),
    installationId: v.id("githubInstallations"),
    owner: v.string(),
    name: v.string(),
    fullName: v.string(),
    defaultBranch: v.string(),
    language: v.optional(v.string()),
    isActive: v.boolean(),
    createdAt: v.float64(),
    updatedAt: v.float64(),
  })
    .index("by_user", ["userId"])
    .index("by_full_name", ["fullName"])
    .index("by_user_and_full_name", ["userId", "fullName"])
    .index("by_installation", ["installationId"])
    .index("by_active", ["isActive", "updatedAt"]),

  repoSettings: defineTable({
    repoId: v.id("repos"),
    approvalPolicy: v.optional(
      v.union(
        v.literal("auto_approve"),
        v.literal("require_label"),
        v.literal("require_comment"),
      ),
    ),
    autoApproveThreshold: v.optional(v.float64()),
    maxDailyRuns: v.optional(v.int64()),
    customAreaLabels: v.optional(v.array(v.string())),
    enabledEventTypes: v.optional(
      v.array(
        v.union(
          v.literal("issues.opened"),
          v.literal("issues.labeled"),
          v.literal("issue_comment.created"),
        ),
      ),
    ),
    createdAt: v.optional(v.float64()),
    updatedAt: v.optional(v.float64()),
    labelTaxonomy: v.optional(v.array(v.string())),
    approvalMode: v.union(
      v.literal("auto"),
      v.literal("label_required"),
      v.literal("comment_required"),
    ),
    maxConcurrentRuns: v.int64(),
    dailyRunLimit: v.int64(),
    sandboxTimeoutSeconds: v.int64(),
    networkEnabled: v.boolean(),
  }).index("by_repo", ["repoId"]),

  issues: defineTable({
    repoId: v.id("repos"),
    githubIssueNumber: v.int64(),
    githubIssueUrl: v.string(),
    title: v.string(),
    body: v.optional(v.string()),
    authorLogin: v.string(),
    githubCreatedAt: v.optional(v.string()),
    labels: v.array(v.string()),
    state: v.union(v.literal("open"), v.literal("closed")),
    commentsSnapshot: v.optional(
      v.array(
        v.object({
          authorLogin: v.string(),
          body: v.string(),
          createdAt: v.string(),
        }),
      ),
    ),
    linkedPRs: v.optional(v.array(v.string())),
    snapshottedAt: v.float64(),
    createdAt: v.float64(),
  })
    .index("by_repo_and_snapshotted_at", ["repoId", "snapshottedAt"])
    .index("by_repo_and_github_issue_number_and_snapshotted_at", [
      "repoId",
      "githubIssueNumber",
      "snapshottedAt",
    ])
    .index("by_created", ["createdAt"]),

  runs: defineTable({
    runId: v.string(),
    userId: v.optional(v.id("users")),
    issueId: v.id("issues"),
    repoId: v.id("repos"),
    triggeredBy: v.union(
      v.literal("issue_opened"),
      v.literal("label_added"),
      v.literal("comment_command"),
      v.literal("manual"),
    ),
    triggeredByUserId: v.optional(v.id("users")),
    status: v.union(
      v.literal("pending"),
      v.literal("triaging"),
      v.literal("awaiting_approval"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("needs_info"),
      v.literal("reproducing"),
      v.literal("verifying"),
      v.literal("reporting"),
      v.literal("completed"),
      v.literal("report_failed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    startedAt: v.float64(),
    completedAt: v.optional(v.float64()),
    approvedBy: v.optional(v.string()),
    approvedAt: v.optional(v.float64()),
    verdict: v.optional(verdictValidator),
    errorMessage: v.optional(v.string()),
    approvalDecision: v.optional(
      v.union(
        v.literal("approved"),
        v.literal("rejected"),
        v.literal("request_info"),
      ),
    ),
    approvalUpdatedAt: v.optional(v.float64()),
  })
    .index("by_run_id", ["runId"])
    .index("by_user_and_started_at", ["userId", "startedAt"])
    .index("by_issue", ["issueId", "startedAt"])
    .index("by_repo", ["repoId", "startedAt"])
    .index("by_status", ["status", "startedAt"])
    .index("by_created", ["startedAt"]),

  triageResults: defineTable({
    runId: v.id("runs"),
    userId: v.optional(v.id("users")),
    repoId: v.optional(v.id("repos")),
    issueId: v.optional(v.id("issues")),
    artifact: v.optional(v.any()),
    classificationType: v.optional(
      v.union(
        v.literal("bug"),
        v.literal("docs"),
        v.literal("question"),
        v.literal("feature"),
        v.literal("build"),
        v.literal("test"),
      ),
    ),
    severity: v.optional(
      v.union(
        v.literal("low"),
        v.literal("medium"),
        v.literal("high"),
        v.literal("critical"),
      ),
    ),
    confidence: v.optional(v.float64()),
    reproEligible: v.optional(v.boolean()),
    summary: v.optional(v.string()),
    tokensUsed: v.optional(
      v.object({
        input: v.float64(),
        output: v.float64(),
      }),
    ),
    schemaVersion: v.optional(v.string()),
    classification: v.optional(classificationValidator),
    reproHypothesis: v.optional(reproHypothesisValidator),
    rawResponse: v.optional(v.string()),
    createdAt: v.float64(),
  })
    .index("by_run", ["runId"])
    .index("by_repo", ["repoId"])
    .index("by_classification_type", ["classificationType"])
    .index("by_user_and_classification_type", [
      "userId",
      "classificationType",
      "createdAt",
    ]),

  reproContracts: defineTable({
    runId: v.id("runs"),
    schemaVersion: v.string(),
    acceptance: v.object({
      artifactType: v.union(v.literal("test"), v.literal("script")),
      mustFailOnBaseRevision: v.boolean(),
      mustBeDeterministic: v.object({
        reruns: v.int64(),
        allowedFlakeRate: v.float64(),
      }),
      mustNotRequireNetwork: v.boolean(),
      failureSignal: failureSignalValidator,
    }),
    sandboxPolicy: sandboxPolicyValidator,
    budgets: v.object({
      wallClockSeconds: v.int64(),
      maxIterations: v.int64(),
    }),
    createdAt: v.float64(),
  }).index("by_run", ["runId"]),

  reproPlans: defineTable({
    runId: v.id("runs"),
    schemaVersion: v.string(),
    baseRevision: v.object({
      ref: v.string(),
      sha: v.string(),
    }),
    environmentStrategy: reproPlanEnvironmentStrategyValidator,
    commands: v.array(
      v.object({
        cwd: v.string(),
        cmd: v.string(),
      }),
    ),
    artifact: v.object({
      type: v.string(),
      path: v.string(),
      entrypoint: v.optional(v.string()),
    }),
    createdAt: v.float64(),
  }).index("by_run", ["runId"]),

  reproRuns: defineTable({
    runId: v.id("runs"),
    schemaVersion: v.string(),
    iteration: v.int64(),
    sandbox: v.object({
      kind: v.string(),
      imageDigest: v.optional(v.string()),
      network: v.string(),
      uid: v.optional(v.int64()),
    }),
    steps: v.array(stepResultValidator),
    failureObserved: v.optional(
      v.object({
        kind: v.string(),
        matchAny: v.optional(v.array(v.string())),
        traceExcerptSha256: v.optional(v.string()),
      }),
    ),
    failureType: v.optional(reproRunFailureTypeValidator),
    environmentStrategy: v.optional(reproRunEnvironmentStrategyValidator),
    artifactContent: v.optional(v.string()),
    logStorageId: v.optional(v.id("_storage")),
    durationMs: v.int64(),
    createdAt: v.float64(),
  })
    .index("by_run", ["runId", "iteration"])
    .index("by_log_storage_id", ["logStorageId"]),

  verifications: defineTable({
    runId: v.id("runs"),
    schemaVersion: v.string(),
    verdict: verdictValidator,
    determinism: v.object({
      reruns: v.int64(),
      fails: v.int64(),
      flakeRate: v.float64(),
    }),
    policyChecks: v.object({
      networkUsed: v.boolean(),
      secretsAccessed: v.boolean(),
      writesOutsideWorkspace: v.boolean(),
      ranAsRoot: v.boolean(),
    }),
    evidence: v.object({
      failingCmd: v.string(),
      exitCode: v.int64(),
      stderrSha256: v.optional(v.string()),
    }),
    notes: v.optional(v.string()),
    logStorageId: v.optional(v.id("_storage")),
    createdAt: v.float64(),
  })
    .index("by_run", ["runId"])
    .index("by_log_storage_id", ["logStorageId"]),

  reports: defineTable({
    runId: v.id("runs"),
    commentId: v.optional(v.number()),
    labelsApplied: v.array(v.string()),
    reportType: v.union(v.literal("triage"), v.literal("verification")),
    status: v.union(
      v.literal("posting"),
      v.literal("posted"),
      v.literal("failed"),
    ),
    createdAt: v.float64(),
    updatedAt: v.float64(),
  }).index("by_run", ["runId"]),

  webhookDeliveries: defineTable({
    deliveryId: v.string(),
    event: v.string(),
    action: v.string(),
    processedAt: v.float64(),
  }).index("by_delivery_id", ["deliveryId"]),
});
