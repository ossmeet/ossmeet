import { createFileRoute } from "@tanstack/react-router";
import { createJsonLdScript, createPageHead, buildWebPageGraph } from "@/lib/seo";

export const Route = createFileRoute("/status")({
  head: () =>
    createPageHead({
      title: "Service Status — OSSMeet",
      description:
        "Real-time status of OSSMeet infrastructure services, including meetings, whiteboards, and related systems.",
      path: "/status",
      scripts: [
        createJsonLdScript(
          buildWebPageGraph({
            title: "Service Status — OSSMeet",
            description:
              "Real-time status of OSSMeet infrastructure services, including meetings, whiteboards, and related systems.",
            path: "/status",
          }),
        ),
      ],
    }),
});
