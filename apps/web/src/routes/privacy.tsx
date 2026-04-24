import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — OSSMeet" },
      { name: "description", content: "Read the OSSMeet privacy policy to understand how we collect, use, and protect your data." },
      { property: "og:title", content: "Privacy Policy — OSSMeet" },
      { property: "og:url", content: "https://ossmeet.com/privacy" },
    ],
    links: [{ rel: "canonical", href: "https://ossmeet.com/privacy" }],
  }),
});
