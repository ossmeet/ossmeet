import { createFileRoute } from "@tanstack/react-router";
import { createJsonLdScript, createPageHead, buildWebPageGraph } from "@/lib/seo";

export const Route = createFileRoute("/terms")({
  head: () =>
    createPageHead({
      title: "Terms of Service — OSSMeet",
      description:
        "Read the OSSMeet terms of service governing use of the video meeting, whiteboard, and account platform.",
      path: "/terms",
      scripts: [
        createJsonLdScript(
          buildWebPageGraph({
            title: "Terms of Service — OSSMeet",
            description:
              "Read the OSSMeet terms of service governing use of the video meeting, whiteboard, and account platform.",
            path: "/terms",
          }),
        ),
      ],
    }),
});
