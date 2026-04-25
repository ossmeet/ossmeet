import { createFileRoute, redirect } from "@tanstack/react-router";
import { sanitizeInternalRedirect } from "@/lib/safe-redirect";
import { createPageHead } from "@/lib/seo";

export const Route = createFileRoute("/verify")({
  validateSearch: (raw): { email: string; mode?: "signup" | "login"; redirect?: string } => ({
    email: typeof raw?.email === "string" ? raw.email : "",
    mode:
      raw?.mode === "signup" || raw?.mode === "login"
        ? (raw.mode as "signup" | "login")
        : undefined,
    redirect: sanitizeInternalRedirect(raw?.redirect),
  }),
  beforeLoad: ({ search }) => {
    if (!search.email) {
      throw redirect({ to: "/auth" });
    }
  },
  head: () =>
    createPageHead({
      title: "Verify Email — OSSMeet",
      description: "Verify your email address to continue signing in to OSSMeet.",
      noindex: true,
      canonical: false,
    }),
});
