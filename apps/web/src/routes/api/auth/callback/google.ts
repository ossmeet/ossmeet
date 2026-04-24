import { createFileRoute } from "@tanstack/react-router";
import { handleGoogleCallbackRequest } from "@/server/auth/oauth-google-callback.server";
import { logError } from "@/lib/logger";
import { isSafeInternalRedirect } from "@/lib/safe-redirect";

export const Route = createFileRoute("/api/auth/callback/google")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Exchange the authorization code server-side to avoid
        // leaking it in browser history and Referer headers
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        if (error) {
          return new Response(null, {
            status: 302,
            headers: { Location: `/auth?error=${encodeURIComponent(error)}` },
          });
        }

        if (code && state) {
          try {
            await handleGoogleCallbackRequest(request, { code, state });
            // Set-Cookie headers written by appendCookies() onto the H3 event
            // response headers are automatically merged into this redirect
            // response by TanStack Start's mergeEventResponseHeaders for
            // non-2xx responses. Do NOT copy them manually here — that would
            // produce duplicate Set-Cookie headers.
            const cookieHeader = request.headers.get("Cookie") ?? "";
            const rawRedirect = cookieHeader
              .split(";")
              .map((c) => c.trim())
              .find((c) => c.startsWith("oauth_redirect="))
              ?.slice("oauth_redirect=".length);
            const destination =
              rawRedirect && isSafeInternalRedirect(decodeURIComponent(rawRedirect))
                ? decodeURIComponent(rawRedirect)
                : "/dashboard";
            return new Response(null, {
              status: 302,
              headers: { Location: destination },
            });
          } catch (err) {
            logError("[OAuth Callback Error]", err);
            // Map known error types to user-safe codes, never expose raw error messages
            let errorCode = "auth_failed";
            if (err && typeof err === "object" && "code" in err) {
              const code = (err as { code: string }).code;
              if (code === "ACCOUNT_LINK_REQUIRED") errorCode = "account_link_required";
              else if (code === "RATE_LIMITED") errorCode = "rate_limited";
              else if (code === "OAUTH_ERROR") errorCode = "oauth_error";
            } else if (err instanceof Error) {
              const msg = err.message;
              if (
                msg.includes("OAuth") ||
                msg.includes("token") ||
                msg.includes("email verified")
              ) {
                errorCode = "oauth_error";
              }
            }
            return new Response(null, {
              status: 302,
              headers: { Location: `/auth?error=${encodeURIComponent(errorCode)}` },
            });
          }
        }

        return new Response(null, {
          status: 302,
          headers: { Location: "/auth" },
        });
      },
    },
  },
});
