import { createFileRoute } from "@tanstack/react-router";
import { createJsonLdScript, createPageHead, buildWebPageGraph } from "@/lib/seo";

export const Route = createFileRoute("/refund")({
  head: () =>
    createPageHead({
      title: "Refund Policy — OSSMeet",
      description:
        "Read the OSSMeet refund policy to understand cancellations, refunds, and subscription billing for paid plans.",
      path: "/refund",
      scripts: [
        createJsonLdScript(
          buildWebPageGraph({
            title: "Refund Policy — OSSMeet",
            description:
              "Read the OSSMeet refund policy to understand cancellations, refunds, and subscription billing for paid plans.",
            path: "/refund",
          }),
        ),
      ],
    }),
});
