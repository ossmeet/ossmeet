import { createFileRoute } from "@tanstack/react-router";
import { createJsonLdScript, createPageHead, buildWebPageGraph } from "@/lib/seo";

export const Route = createFileRoute("/privacy")({
  head: () =>
    createPageHead({
      title: "Privacy Policy — OSSMeet",
      description:
        "Read the OSSMeet privacy policy to understand how we collect, use, and protect account, meeting, and whiteboard data.",
      path: "/privacy",
      scripts: [
        createJsonLdScript(
          buildWebPageGraph({
            title: "Privacy Policy — OSSMeet",
            description:
              "Read the OSSMeet privacy policy to understand how we collect, use, and protect account, meeting, and whiteboard data.",
            path: "/privacy",
          }),
        ),
      ],
    }),
});
