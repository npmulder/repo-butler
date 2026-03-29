import { beforeEach, describe, expect, it, vi } from "vitest";

const anthropicState = vi.hoisted(() => {
  class MockAPIError extends Error {
    status?: number;

    constructor(status: number, message: string) {
      super(message);
      this.name = "MockAPIError";
      this.status = status;
    }
  }

  class MockRateLimitError extends MockAPIError {
    constructor(message = "Rate limited") {
      super(429, message);
      this.name = "MockRateLimitError";
    }
  }

  class MockAPIConnectionError extends Error {
    constructor(message = "Connection failed") {
      super(message);
      this.name = "MockAPIConnectionError";
    }
  }

  return {
    create: vi.fn(),
    MockAPIError,
    MockRateLimitError,
    MockAPIConnectionError,
  };
});

vi.mock("@anthropic-ai/sdk", () => {
  return {
    APIError: anthropicState.MockAPIError,
    RateLimitError: anthropicState.MockRateLimitError,
    APIConnectionError: anthropicState.MockAPIConnectionError,
  };
});

vi.mock("../lib/claude", () => {
  return {
    DEFAULT_MAX_TOKENS: 4096,
    MODELS: {
      triage: "claude-sonnet-4-20250514",
      reproduce: "claude-sonnet-4-20250514",
      verify: "claude-sonnet-4-20250514",
    },
    getAnthropicClient: () => ({
      messages: {
        create: anthropicState.create,
      },
    }),
  };
});

import { internal } from "./_generated/api";
import {
  createTestConvex,
  seedInstallation,
  seedIssue,
  seedRepo,
  seedRun,
  seedUser,
} from "../test/convex/testHelpers";

function buildClaudeResponse({
  reproEligible = true,
  summary = "Parser crash is reproducible with a deterministic exception.",
}: {
  reproEligible?: boolean;
  summary?: string;
} = {}) {
  return {
    id: "msg_test_123",
    container: null,
    content: [
      { type: "text", text: "Submitting structured triage output." },
      {
        type: "tool_use",
        id: "toolu_test_123",
        name: "submit_triage",
        input: {
          classification: {
            type: "bug",
            area: ["parser"],
            severity: "high",
            labels_suggested: ["type:bug", "area:parser"],
            confidence: 0.92,
          },
          repro_hypothesis: {
            minimal_steps_guess: [
              "Create an empty YAML file.",
              "Run the parser against it.",
            ],
            expected_failure_signal: {
              kind: "exception",
              match_any: ["ParseError"],
            },
            environment_assumptions: {
              os: "Ubuntu 22.04",
              runtime: "Node 20.x",
            },
          },
          repro_eligible: reproEligible,
          summary,
        },
      },
    ],
    model: "claude-sonnet-4-20250514",
    role: "assistant",
    stop_reason: "end_turn",
    stop_sequence: null,
    type: "message",
    usage: {
      cache_creation: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      inference_geo: null,
      input_tokens: 321,
      output_tokens: 123,
      server_tool_use: null,
    },
  };
}

async function setupPipelineFixture() {
  const t = createTestConvex();
  const { userId } = await seedUser(t);
  const installationId = await seedInstallation(t, userId);
  const { repoId } = await seedRepo(t, { userId, installationId });
  const issueId = await seedIssue(t, repoId, {
    title: "Parser crash on empty YAML input",
    body: "Running the parser on an empty YAML file throws a ParseError.",
  });
  const runId = await seedRun(t, {
    userId,
    repoId,
    issueId,
    runId: "run_pipeline",
  });

  return { t, repoId, issueId, runId };
}

beforeEach(() => {
  anthropicState.create.mockReset();
  vi.useRealTimers();
});

describe("pipeline.runTriage", () => {
  it("stores triage output and leaves repro-eligible runs awaiting approval", async () => {
    anthropicState.create.mockResolvedValue(buildClaudeResponse());
    const { t, runId, issueId } = await setupPipelineFixture();

    await t.action(internal.pipeline.runTriage, { runId, issueId });

    const { run, triage } = await t.run(async (ctx) => {
      return {
        run: await ctx.db.get(runId),
        triage: await ctx.db
          .query("triageResults")
          .withIndex("by_run", (q) => q.eq("runId", runId))
          .unique(),
      };
    });

    expect(anthropicState.create).toHaveBeenCalledTimes(1);
    expect(
      anthropicState.create.mock.calls[0]?.[0]?.messages[0]?.content,
    ).toContain("Parser crash on empty YAML input");
    expect(run).toMatchObject({
      status: "awaiting_approval",
      errorMessage:
        "No repo settings configured; defaulting to maintainer label approval",
    });
    expect(triage).toMatchObject({
      runId,
      reproEligible: true,
      summary: "Parser crash is reproducible with a deterministic exception.",
      tokensUsed: {
        input: 321,
        output: 123,
      },
    });
  });

  it("completes runs when triage marks them as not repro eligible", async () => {
    anthropicState.create.mockResolvedValue(
      buildClaudeResponse({ reproEligible: false }),
    );
    const { t, runId, issueId } = await setupPipelineFixture();

    await t.action(internal.pipeline.runTriage, { runId, issueId });

    const run = await t.run(async (ctx) => await ctx.db.get(runId));

    expect(run).toMatchObject({
      status: "completed",
    });
    expect(run?.completedAt).toBeTypeOf("number");
  });

  it("fails the run when Claude returns no tool block", async () => {
    anthropicState.create.mockResolvedValue({
      ...buildClaudeResponse(),
      content: [{ type: "text", text: "No structured output." }],
    });
    const { t, runId, issueId } = await setupPipelineFixture();

    await t.action(internal.pipeline.runTriage, { runId, issueId });

    const run = await t.run(async (ctx) => await ctx.db.get(runId));

    expect(run).toMatchObject({
      status: "failed",
    });
    expect(run?.errorMessage).toContain("Claude did not return submit_triage");
  });

  it("retries rate limit errors with backoff before succeeding", async () => {
    vi.useFakeTimers();
    anthropicState.create
      .mockRejectedValueOnce(new anthropicState.MockRateLimitError("Slow down"))
      .mockResolvedValueOnce(buildClaudeResponse());
    const { t, runId, issueId } = await setupPipelineFixture();

    const actionPromise = t.action(internal.pipeline.runTriage, {
      runId,
      issueId,
    });
    await vi.runAllTimersAsync();
    await actionPromise;

    const run = await t.run(async (ctx) => await ctx.db.get(runId));

    expect(anthropicState.create).toHaveBeenCalledTimes(2);
    expect(run?.status).toBe("awaiting_approval");
  });

  it.each([500, 502, 503, 504])(
    "retries Claude API %s errors before succeeding",
    async (status) => {
      vi.useFakeTimers();
      anthropicState.create
        .mockRejectedValueOnce(
          new anthropicState.MockAPIError(status, `status ${status}`),
        )
        .mockResolvedValueOnce(buildClaudeResponse());
      const { t, runId, issueId } = await setupPipelineFixture();

      const actionPromise = t.action(internal.pipeline.runTriage, {
        runId,
        issueId,
      });
      await vi.runAllTimersAsync();
      await actionPromise;

      const run = await t.run(async (ctx) => await ctx.db.get(runId));

      expect(anthropicState.create).toHaveBeenCalledTimes(2);
      expect(run?.status).toBe("awaiting_approval");
    },
  );

  it("fails immediately for non-retryable errors", async () => {
    anthropicState.create.mockRejectedValueOnce(
      new anthropicState.MockAPIError(400, "Bad request"),
    );
    const { t, runId, issueId } = await setupPipelineFixture();

    await t.action(internal.pipeline.runTriage, { runId, issueId });

    const run = await t.run(async (ctx) => await ctx.db.get(runId));

    expect(anthropicState.create).toHaveBeenCalledTimes(1);
    expect(run).toMatchObject({
      status: "failed",
      errorMessage: "Claude API error (400): Bad request",
    });
  });
});
