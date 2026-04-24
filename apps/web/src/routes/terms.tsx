import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — OSSMeet" },
      { name: "description", content: "Read the OSSMeet terms of service governing your use of our video meeting and whiteboard platform." },
      { property: "og:title", content: "Terms of Service — OSSMeet" },
      { property: "og:url", content: "https://ossmeet.com/terms" },
    ],
    links: [{ rel: "canonical", href: "https://ossmeet.com/terms" }],
  }),
});
