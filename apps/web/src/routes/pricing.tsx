import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — OSSMeet" },
      {
        name: "description",
        content:
          "Simple, transparent pricing for video meetings and collaborative whiteboards. Free tier available, upgrade for advanced features.",
      },
      { property: "og:title", content: "Pricing — OSSMeet" },
      { property: "og:description", content: "Simple, transparent pricing for video meetings and collaborative whiteboards. Free tier available, upgrade for advanced features." },
      { property: "og:url", content: "https://ossmeet.com/pricing" },
      { name: "twitter:title", content: "Pricing — OSSMeet" },
      { name: "twitter:description", content: "Simple, transparent pricing for video meetings and collaborative whiteboards. Free tier available, upgrade for advanced features." },
    ],
    links: [{ rel: "canonical", href: "https://ossmeet.com/pricing" }],
  }),
});
