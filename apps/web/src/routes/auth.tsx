import { createFileRoute } from "@tanstack/react-router";
import { sanitizeInternalRedirect } from "@/lib/safe-redirect";
import { createPageHead } from "@/lib/seo";

export const Route = createFileRoute("/auth")({
  validateSearch: (raw): { mode?: "login" | "signup"; redirect?: string; error?: string } => ({
    mode:
      raw?.mode === "login" || raw?.mode === "signup"
        ? (raw.mode as "login" | "signup")
        : undefined,
    redirect: sanitizeInternalRedirect(raw?.redirect),
    error: typeof raw?.error === "string" ? raw.error : undefined,
  }),
  head: () =>
    createPageHead({
      title: "Sign In — OSSMeet",
      description: "Sign in to OSSMeet to create meetings, manage spaces, and access account settings.",
      noindex: true,
      canonical: false,
    }),
});
