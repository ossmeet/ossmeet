import { createFileRoute } from "@tanstack/react-router";
import { sanitizeInternalRedirect } from "@/lib/safe-redirect";

export const Route = createFileRoute("/auth")({
  validateSearch: (raw): { mode?: "login" | "signup"; redirect?: string; error?: string } => ({
    mode:
      raw?.mode === "login" || raw?.mode === "signup"
        ? (raw.mode as "login" | "signup")
        : undefined,
    redirect: sanitizeInternalRedirect(raw?.redirect),
    error: typeof raw?.error === "string" ? raw.error : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Sign In — OSSMeet" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});
