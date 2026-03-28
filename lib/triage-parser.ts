import type {
  Message,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages/messages";

import type { TriageInput } from "./claude";
import type { TriageResult } from "./generated/triage.v1";
import { validateArtifact } from "./schema-validator";
import { TRIAGE_TOOL_NAME } from "./prompts/triage";

export type TriageToolOutput = Pick<
  TriageResult,
  "classification" | "repro_hypothesis" | "repro_eligible" | "summary"
>;

export type TriageArtifact = TriageResult;

function isSubmitTriageBlock(
  block: Message["content"][number],
): block is ToolUseBlock {
  return block.type === "tool_use" && block.name === TRIAGE_TOOL_NAME;
}

export function extractTriageFromResponse(
  response: Message,
): TriageToolOutput | null {
  const toolBlock = response.content.find(isSubmitTriageBlock);

  if (!toolBlock) {
    return null;
  }

  return toolBlock.input as TriageToolOutput;
}

export function buildTriageArtifact(
  runId: string,
  input: TriageInput,
  toolOutput: TriageToolOutput,
): TriageArtifact {
  return {
    schema_version: "rb.triage.v1",
    run_id: runId,
    repo: {
      owner: input.repo.owner,
      name: input.repo.name,
      default_branch: input.repo.defaultBranch,
    },
    issue: {
      number: input.issue.number,
      title: input.issue.title,
      url: input.issue.url,
    },
    classification: toolOutput.classification,
    repro_hypothesis: toolOutput.repro_hypothesis,
    repro_eligible: toolOutput.repro_eligible,
    summary: toolOutput.summary,
  };
}

export function validateTriageArtifact(
  artifact: TriageArtifact,
): { valid: true } | { valid: false; errors: string[] } {
  return validateArtifact("rb.triage.v1", artifact);
}
