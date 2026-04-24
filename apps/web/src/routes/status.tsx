import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/status")({
  head: () => ({
    meta: [
      { title: "Service Status — OSSMeet" },
      {
        name: "description",
        content:
          "Real-time status of OSSMeet infrastructure services including video meetings and the collaborative whiteboard.",
      },
      { property: "og:title", content: "Service Status — OSSMeet" },
      { property: "og:url", content: "https://ossmeet.com/status" },
    ],
    links: [{ rel: "canonical", href: "https://ossmeet.com/status" }],
  }),
});
