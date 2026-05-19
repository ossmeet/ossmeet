import { createFileRoute } from "@tanstack/react-router";
import { handleLivekitWebhookRequest } from "./-webhook.server";

/**
 * LiveKit webhook receiver.
 * On egress_ended with EGRESS_COMPLETE, registers the recording file as a
 * meeting artifact so it appears in the space's Assets panel.
 *
 * LiveKit sends webhooks with an Authorization header containing a signed JWT.
 * Configure the webhook URL in your LiveKit project/server settings:
 *   https://your-app.com/api/livekit/webhook
 */
export const Route = createFileRoute("/api/livekit/webhook")({
  server: {
    handlers: {
      POST: ({ request }) => handleLivekitWebhookRequest(request),
    },
  },
});
