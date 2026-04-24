import { createFileRoute, redirect } from "@tanstack/react-router";
import { sanitizeInternalRedirect } from "@/lib/safe-redirect";

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
  head: () => ({
    meta: [{ title: "Verify Email — OSSMeet" }],
  }),
});
