import { httpRouter } from "convex/server";

import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { authKit } from "./auth";
import { verifyWebhookSignature } from "./lib/githubWebhooks";

const http = httpRouter();

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

    let payload: { action?: unknown };

    try {
      payload = JSON.parse(bodyText) as { action?: unknown };
    } catch {
      return new Response("Invalid JSON payload", { status: 400 });
    }

    try {
      const result = await ctx.runMutation(internal.webhooks.processWebhook, {
        deliveryId,
        event,
        action: typeof payload.action === "string" ? payload.action : "",
        payload: bodyText,
      });

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
