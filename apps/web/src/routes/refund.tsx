import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/refund")({
  head: () => ({
    meta: [
      { title: "Refund Policy — OSSMeet" },
      { name: "description", content: "Read the OSSMeet refund policy to understand how cancellations and refunds work for our subscription plans." },
      { property: "og:title", content: "Refund Policy — OSSMeet" },
      { property: "og:url", content: "https://ossmeet.com/refund" },
    ],
    links: [{ rel: "canonical", href: "https://ossmeet.com/refund" }],
  }),
});
