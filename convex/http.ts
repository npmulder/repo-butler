import { httpRouter } from "convex/server";

import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { authKit } from "./auth";
import { verifyWebhookSignature } from "./lib/githubWebhooks";

const http = httpRouter();

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

function extractRepoFullName(payload: unknown) {
  if (!isRecord(payload)) {
    return null;
  }

  return readString(readRecord(payload, "repository")?.full_name);
}

function extractIssueNumber(payload: unknown) {
  if (!isRecord(payload)) {
    return null;
  }

  const issue = readRecord(payload, "issue");
  const issueNumber = issue?.number;

  if (typeof issueNumber === "number" && Number.isSafeInteger(issueNumber)) {
    return BigInt(issueNumber);
  }

  if (typeof issueNumber === "string" && /^-?\d+$/.test(issueNumber)) {
    return BigInt(issueNumber);
  }

  return null;
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

function extractActor(payload: unknown) {
  if (!isRecord(payload)) {
    return null;
  }

  return (
    readString(readRecord(payload, "sender")?.login) ??
    readString(readRecord(readRecord(payload, "comment") ?? {}, "user")?.login)
  );
}

if (authKit) {
  authKit.registerRoutes(http);
}

http.route({
  path: "/github/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = new Uint8Array(await request.arrayBuffer());
    const bodyText = new TextDecoder().decode(rawBody);
    const signature = request.headers.get("x-hub-signature-256") ?? "";
    const event = request.headers.get("x-github-event") ?? "";
    const deliveryId = request.headers.get("x-github-delivery") ?? "";

    if (!signature || !event || !deliveryId) {
      return new Response("Missing required GitHub webhook headers", {
        status: 400,
      });
    }

    // HTTP actions run on Convex servers, so this secret must be configured
    // as a Convex environment variable for deployed webhook verification.
    const webhookSecret = process.env.GITHUB_APP_WEBHOOK_SECRET?.trim();

    if (!webhookSecret) {
      console.error(
        "GitHub webhook secret is not configured in Convex environment variables.",
      );
      return new Response("Webhook secret is not configured", { status: 500 });
    }

    const isValid = await verifyWebhookSignature(
      rawBody,
      signature,
      webhookSecret,
    );

    if (!isValid) {
      return new Response("Invalid signature", { status: 401 });
    }

    let payload: unknown;

    try {
      payload = JSON.parse(bodyText) as unknown;
    } catch {
      return new Response("Invalid JSON payload", { status: 400 });
    }

    const action =
      typeof payload === "object" &&
      payload !== null &&
      "action" in payload &&
      typeof payload.action === "string"
        ? payload.action
        : "";

    try {
      const result = await ctx.runMutation(internal.webhooks.processWebhook, {
        deliveryId,
        event,
        action,
        payload,
      });

      if (!result.duplicate) {
        if (event === "issues" && action === "labeled") {
          const repoFullName = extractRepoFullName(payload);
          const issueNumber = extractIssueNumber(payload);
          const labelName = extractLabelName(payload);
          const actor = extractActor(payload);

          if (repoFullName && issueNumber !== null && labelName && actor) {
            await ctx.runMutation(internal.webhooks.handleLabelAdded, {
              repoFullName,
              issueNumber,
              labelName,
              actor,
            });
          }
        }

        if (event === "issue_comment" && action === "created") {
          const repoFullName = extractRepoFullName(payload);
          const issueNumber = extractIssueNumber(payload);
          const commentBody = extractCommentBody(payload);
          const actor = extractActor(payload);

          if (repoFullName && issueNumber !== null && commentBody && actor) {
            await ctx.runMutation(internal.webhooks.handleCommentAdded, {
              repoFullName,
              issueNumber,
              commentBody,
              actor,
            });
          }
        }
      }

      return new Response(result.duplicate ? "Already processed" : "OK", {
        status: 200,
      });
    } catch (error) {
      console.error("GitHub webhook processing error:", error);
      return new Response("Processing error", { status: 500 });
    }
  }),
});

export default http;
