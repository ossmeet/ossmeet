import { createFileRoute, notFound } from "@tanstack/react-router";
import { resolveSessionGate } from "@/lib/auth-gate";

export const Route = createFileRoute("/invite/$token")({
  params: {
    parse: ({ token }) => {
      if (!token || token.length < 10 || !/^[a-zA-Z0-9_-]+$/.test(token)) {
        throw notFound();
      }
      return { token };
    },
    stringify: ({ token }) => ({ token }),
  },
  preload: false,
  ssr: false,
  beforeLoad: async ({ context, location }) => {
    return resolveSessionGate(context, location);
  },
});
