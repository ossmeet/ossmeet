import { createFileRoute } from "@tanstack/react-router";
import { resolveSessionGate } from "@/lib/auth-gate";

export const Route = createFileRoute("/_authed")({
  ssr: false,
  beforeLoad: async ({ context, location }) => {
    return resolveSessionGate(context, location);
  },
});
