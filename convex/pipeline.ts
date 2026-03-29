"use node";

import {
  APIConnectionError,
  APIError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { internalAction, type ActionCtx } from "./_generated/server";
import {
  DEFAULT_MAX_TOKENS,
  MODELS,
  getAnthropicClient,
  getAnthropicRequestOptions,
  getLlmProvider,
  type LlmProvider,
  type TriageInput,
} from "../lib/claude";
import {
  TRIAGE_SYSTEM_PROMPT,
  TRIAGE_TOOL_DEFINITION,
  TRIAGE_TOOL_NAME,
  buildTriageUserPrompt,
} from "../lib/prompts/triage";
import {
  buildTriageArtifact,
  extractTriageFromResponse,
  validateTriageArtifact,
} from "../lib/triage-parser";

const RETRY_DELAYS_MS = [1000, 3000, 5000] as const;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

type RetryDecision = {
  llmProvider: LlmProvider;
  status?: number;
  code?: number | string;
  message: string;
  providerName?: string;
  exhaustedProviders: boolean;
  retryable: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readCode(value: unknown): number | string | undefined {
  return typeof value === "number" || typeof value === "string" ? value : undefined;
}

function getErrorPayload(
  error: unknown,
  llmProvider: LlmProvider,
): Record<string, unknown> | undefined {
  const rawPayload =
    error instanceof APIError && isRecord(error.error)
      ? error.error
      : isRecord(error) && isRecord(error.error)
        ? error.error
        : undefined;

  if (!rawPayload) {
    return undefined;
  }

  if (llmProvider === "openrouter") {
    if (isRecord(rawPayload.error)) {
      return rawPayload.error;
    }

    if (isRecord(rawPayload.response) && isRecord(rawPayload.response.error)) {
      return rawPayload.response.error;
    }
  }

  return rawPayload;
}

function getProviderName(
  error: unknown,
  payload: Record<string, unknown> | undefined,
): string | undefined {
  if (payload && isRecord(payload.metadata)) {
    const providerName = readString(payload.metadata.provider_name);

    if (providerName) {
      return providerName;
    }
  }

  if (isRecord(error)) {
    return readString(error.provider);
  }

  return undefined;
}

function getRetryDecision(
  error: unknown,
  llmProvider: LlmProvider,
): RetryDecision {
  const payload = getErrorPayload(error, llmProvider);
  const status =
    error instanceof APIError && error.status !== undefined
      ? error.status
      : isRecord(error) && typeof error.status === "number"
        ? error.status
        : isRecord(error) && typeof error.statusCode === "number"
          ? error.statusCode
          : typeof payload?.code === "number"
            ? payload.code
            : undefined;
  const code = readCode(payload?.code);
  const message =
    readString(payload?.message) ??
    (error instanceof Error ? error.message : undefined) ??
    "Unknown triage error";
  const lowerMessage = message.toLowerCase();
  const lowerCode = typeof code === "string" ? code.toLowerCase() : undefined;
  const exhaustedProviders =
    llmProvider === "openrouter" &&
    (status === 503 ||
      code === 503 ||
      lowerMessage.includes("all providers exhausted") ||
      lowerMessage.includes("no available model provider"));
  const retryable =
    error instanceof APIConnectionError ||
    error instanceof RateLimitError ||
    (llmProvider === "openrouter"
      ? !exhaustedProviders &&
        ((status !== undefined && RETRYABLE_STATUSES.has(status)) ||
          status === 429 ||
          code === 429 ||
          lowerCode === "rate_limit_exceeded" ||
          lowerMessage.includes("rate limit"))
      : error instanceof APIError && RETRYABLE_STATUSES.has(status ?? 0));

  return {
    llmProvider,
    status,
    code,
    message,
    providerName: getProviderName(error, payload),
    exhaustedProviders,
    retryable,
  };
}

function formatErrorMessage(error: unknown, decision: RetryDecision): string {
  if (decision.llmProvider === "anthropic") {
    if (error instanceof APIError && error.status !== undefined) {
      return `Claude API error (${error.status}): ${error.message}`;
    }

    if (error instanceof Error) {
      return error.message;
    }

    return "Unknown triage error";
  }

  if (decision.status !== undefined) {
    return `OpenRouter API error (${decision.status}): ${decision.message}`;
  }

  if (decision.message) {
    return `OpenRouter error: ${decision.message}`;
  }

  return "Unknown triage error";
}

function buildLogContext(decision: RetryDecision): Record<string, unknown> {
  return {
    llmProvider: decision.llmProvider,
    status: decision.status,
    code: decision.code,
    providerName: decision.providerName,
    exhaustedProviders: decision.exhaustedProviders,
    retryable: decision.retryable,
    message: decision.message,
  };
}

function formatErrorMessageLegacy(error: unknown): string {
  if (error instanceof APIError && error.status !== undefined) {
    return `Claude API error (${error.status}): ${error.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown triage error";
}

function buildTriageInput(
  repo: Doc<"repos">,
  issue: Doc<"issues">,
): TriageInput {
  const repoContext =
    repo.language !== undefined
      ? {
          languages: [repo.language],
          hasTestFramework: false,
        }
      : undefined;

  return {
    repo: {
      owner: repo.owner,
      name: repo.name,
      defaultBranch: repo.defaultBranch,
    },
    issue: {
      number: Number(issue.githubIssueNumber),
      title: issue.title,
      body: issue.body ?? "",
      url: issue.githubIssueUrl,
      author: issue.authorLogin,
      labels: issue.labels,
      createdAt: new Date(
        issue.githubCreatedAt ?? issue.snapshotedAt,
      ).toISOString(),
    },
    ...(repoContext ? { repoContext } : {}),
  };
}

async function requestTriageAssessment(input: TriageInput) {
  const client = getAnthropicClient();
  const llmProvider = getLlmProvider();

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const requestBody: MessageCreateParamsNonStreaming = {
        model: MODELS.triage,
        max_tokens: DEFAULT_MAX_TOKENS,
        system: TRIAGE_SYSTEM_PROMPT,
        tools: [TRIAGE_TOOL_DEFINITION],
        tool_choice: {
          type: "tool",
          name: TRIAGE_TOOL_NAME,
          disable_parallel_tool_use: true,
        },
        messages: [
          {
            role: "user",
            content: buildTriageUserPrompt(input),
          },
        ],
      };

      return await client.messages.create(
        requestBody,
        getAnthropicRequestOptions(requestBody),
      );
    } catch (error) {
      const decision = getRetryDecision(error, llmProvider);

      if (!decision.retryable || attempt === RETRY_DELAYS_MS.length) {
        throw error;
      }

      const delayMs = RETRY_DELAYS_MS[attempt];
      console.warn(
        `[pipeline] Retrying triage request after ${delayMs}ms (attempt ${attempt + 1})`,
        {
          attempt: attempt + 1,
          delayMs,
          ...buildLogContext(decision),
        },
      );
      await sleep(delayMs);
    }
  }

  throw new Error("Triage request exited without a Claude response");
}

async function loadRunContext(
  ctx: ActionCtx,
  runId: Id<"runs">,
  issueId: Id<"issues">,
): Promise<{
  run: Doc<"runs">;
  issue: Doc<"issues">;
  repo: Doc<"repos">;
}> {
  const run: Doc<"runs"> | null = await ctx.runQuery(internal.runs.getById, {
    runId,
  });
  if (!run) {
    throw new Error(`Run ${runId} not found`);
  }

  if (run.issueId !== issueId) {
    throw new Error(`Run ${runId} does not belong to issue ${issueId}`);
  }

  const issue: Doc<"issues"> | null = await ctx.runQuery(internal.issues.getById, {
    issueId,
  });
  if (!issue) {
    throw new Error(`Issue ${issueId} not found`);
  }

  if (issue.repoId !== run.repoId) {
    throw new Error(`Issue ${issueId} does not belong to run ${runId}'s repository`);
  }

  const repo: Doc<"repos"> | null = await ctx.runQuery(internal.repos.getById, {
    repoId: run.repoId,
  });
  if (!repo) {
    throw new Error(`Repo ${run.repoId} not found for run ${runId}`);
  }

  return { run, issue, repo };
}

export const runTriage = internalAction({
  args: {
    runId: v.id("runs"),
    issueId: v.id("issues"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.runs.updateStatus, {
      runId: args.runId,
      status: "triaging",
    });

    try {
      const { run, issue, repo } = await loadRunContext(
        ctx,
        args.runId,
        args.issueId,
      );
      const triageInput = buildTriageInput(repo, issue);
      const response = await requestTriageAssessment(triageInput);
      const toolOutput = extractTriageFromResponse(response);

      if (!toolOutput) {
        throw new Error(
          `Claude did not return ${TRIAGE_TOOL_NAME}. Stop reason: ${response.stop_reason}; content blocks: ${response.content
            .map((block) => block.type)
            .join(", ")}`,
        );
      }

      const artifact = buildTriageArtifact(run.runId, triageInput, toolOutput);
      const validation = validateTriageArtifact(artifact);

      if (!validation.valid) {
        throw new Error(
          `Triage artifact failed schema validation: ${validation.errors.join("; ")}`,
        );
      }

      await ctx.runMutation(internal.artifacts.storeTriage, {
        runId: args.runId,
        artifact,
        tokensUsed: {
          input: response.usage.input_tokens,
          output: response.usage.output_tokens,
        },
      });

      if (toolOutput.repro_eligible) {
        const approval = await ctx.runQuery(internal.approvalGate.checkApproval, {
          repoId: issue.repoId,
          runId: args.runId,
          triageConfidence: toolOutput.classification.confidence,
          reproEligible: true,
        });

        if (approval.approved) {
          const approvedAt = Date.now();

          await ctx.runMutation(internal.runs.updateStatus, {
            runId: args.runId,
            status: "approved",
            approvedBy: "system:auto",
            approvedAt,
            errorMessage: approval.reason,
          });
          // Reproduction scheduling lands in CV-124.
        } else {
          await ctx.runMutation(internal.runs.updateStatus, {
            runId: args.runId,
            status: "awaiting_approval",
            errorMessage: approval.reason,
          });
        }
      } else {
        await ctx.runMutation(internal.runs.updateStatus, {
          runId: args.runId,
          status: "completed",
        });
      }
    } catch (error) {
      const decision = getRetryDecision(error, getLlmProvider());
      const errorMessage =
        decision.llmProvider === "anthropic"
          ? formatErrorMessageLegacy(error)
          : formatErrorMessage(error, decision);

      console.error(
        `[pipeline] Triage failed for run ${args.runId}: ${errorMessage}`,
        buildLogContext(decision),
      );

      await ctx.runMutation(internal.runs.updateStatus, {
        runId: args.runId,
        status: "failed",
        errorMessage,
      });
    }

    return null;
  },
});
